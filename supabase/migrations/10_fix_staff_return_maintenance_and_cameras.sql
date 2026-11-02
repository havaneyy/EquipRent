-- ============================================================================
-- EQUIPRENT MIGRATION 10:
-- 1. Fix "permission denied for table user_profiles" when Admin creates Staff
-- 2. Fix Return Inspection ("Returned as Okay" -> Available, "Damaged" -> Under Maintenance)
-- 3. Add Maintenance Completion automation ("Mark as Fixed" -> Available)
-- 4. Seed / Update Catalog to Camera, Lens, Lighting & Audio Equipment
-- Safe to run on your existing Supabase project (preserves users & orders).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FIX USER_PROFILES PERMISSIONS FOR ADMIN STAFF CREATION & DELETION
--    Grants table privileges governed by RLS while blocking non-admin role changes
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_guard_profile_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Allow system/superuser triggers (such as auth.users signup sync)
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    -- Non-admins cannot insert profiles directly or modify role / account_status
    IF public.fn_current_user_role() <> 'admin' THEN
        IF TG_OP = 'INSERT' THEN
            RAISE EXCEPTION 'Authorization Error: Only administrators can create staff profiles directly.';
        END IF;

        IF NEW.role IS DISTINCT FROM OLD.role OR NEW.account_status IS DISTINCT FROM OLD.account_status THEN
            RAISE EXCEPTION 'Authorization Error: Only administrators can modify user roles or account status.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_role_escalation ON public.user_profiles;
CREATE TRIGGER trg_guard_profile_role_escalation
BEFORE INSERT OR UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_profile_role_escalation();

DROP POLICY IF EXISTS pol_profiles_auth_select ON public.user_profiles;
DROP POLICY IF EXISTS pol_profiles_self_update ON public.user_profiles;
DROP POLICY IF EXISTS pol_profiles_admin_all ON public.user_profiles;

CREATE POLICY pol_profiles_auth_select ON public.user_profiles
    FOR SELECT TO authenticated
    USING (
        auth_user_id = auth.uid()
        OR id = auth.uid()
        OR public.fn_current_user_role() IN ('admin', 'staff')
    );

CREATE POLICY pol_profiles_self_update ON public.user_profiles
    FOR UPDATE TO authenticated
    USING (auth_user_id = auth.uid() OR id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid() OR id = auth.uid());

CREATE POLICY pol_profiles_admin_all ON public.user_profiles
    FOR ALL TO authenticated
    USING (public.fn_current_user_role() = 'admin')
    WITH CHECK (public.fn_current_user_role() = 'admin');

-- Recreate Admin Staff RPC returning JSONB for 100% PostgREST compatibility
DROP FUNCTION IF EXISTS public.sp_admin_upsert_staff_profile(UUID, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.sp_admin_upsert_staff_profile(
    p_auth_user_id UUID,
    p_full_name TEXT,
    p_email TEXT,
    p_phone TEXT,
    p_company_name TEXT DEFAULT 'EquipRent Studio Operations'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile public.user_profiles;
BEGIN
    IF public.fn_current_user_role() <> 'admin' THEN
        RAISE EXCEPTION 'Authorization Error: Only administrators can add or promote staff members.';
    END IF;

    INSERT INTO public.user_profiles (
        id, auth_user_id, full_name, email, phone, company_name, role, requested_role, account_status
    ) VALUES (
        COALESCE(p_auth_user_id, gen_random_uuid()),
        p_auth_user_id,
        trim(p_full_name),
        lower(trim(p_email)),
        trim(p_phone),
        COALESCE(NULLIF(trim(p_company_name), ''), 'EquipRent Studio Operations'),
        'staff',
        NULL,
        'active'
    )
    ON CONFLICT (email) DO UPDATE
    SET auth_user_id = COALESCE(EXCLUDED.auth_user_id, public.user_profiles.auth_user_id),
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        company_name = EXCLUDED.company_name,
        role = 'staff',
        requested_role = NULL,
        account_status = 'active',
        updated_at = NOW()
    RETURNING * INTO v_profile;

    RETURN to_jsonb(v_profile);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sp_admin_upsert_staff_profile(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. FIX EQUIPMENT RETURN & AUTOMATIC MAINTENANCE -> AVAILABLE LIFECYCLE
--    - Returned as Okay   -> item_status = 'returned' -> equipment = 'available'
--    - Returned as Damaged -> item_status = 'damaged'  -> equipment = 'under_maintenance' + work order
--    - Maintenance Fixed   -> maintenance = 'completed' -> equipment = 'available'
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sync_equipment_rental_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        IF NEW.item_status = 'dispatched' THEN
            UPDATE public.equipment
            SET current_status = 'rented',
                updated_at = NOW()
            WHERE id = NEW.equipment_id;
        ELSIF NEW.item_status = 'returned' THEN
            UPDATE public.equipment
            SET current_status = 'available',
                operational_hours = COALESCE(NEW.return_odometer_hours, operational_hours),
                updated_at = NOW()
            WHERE id = NEW.equipment_id;
        ELSIF NEW.item_status = 'damaged' THEN
            UPDATE public.equipment
            SET current_status = 'under_maintenance',
                operational_hours = COALESCE(NEW.return_odometer_hours, operational_hours),
                updated_at = NOW()
            WHERE id = NEW.equipment_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sp_process_equipment_return(
    p_order_item_id UUID,
    p_return_odometer NUMERIC DEFAULT 0,
    p_fuel_level INT DEFAULT 100,
    p_cleanliness INT DEFAULT 5,
    p_integrity INT DEFAULT 5,
    p_inspector_id UUID DEFAULT NULL,
    p_damage_notes TEXT DEFAULT NULL,
    p_penalty_fee NUMERIC DEFAULT 0.00
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_item RECORD;
    v_effective_inspector UUID;
    v_inspector_role public.user_role_type;
    v_has_damage BOOLEAN := FALSE;
    v_new_item_status public.item_rental_status;
    v_parent_order_id UUID;
    v_remaining_dispatched INT;
    v_final_hours NUMERIC;
    v_maintenance_created BOOLEAN := FALSE;
    v_maintenance_id UUID := NULL;
    v_result JSONB;
BEGIN
    IF public.fn_current_user_role() NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'Authorization Error: Current session is not authorized to process returns.';
    END IF;

    v_effective_inspector := COALESCE(p_inspector_id, public.fn_current_profile_id());
    SELECT role INTO v_inspector_role FROM public.user_profiles WHERE id = v_effective_inspector;
    IF v_inspector_role IS NULL OR v_inspector_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'Authorization Error: Inspector is not authorized.';
    END IF;

    SELECT roi.*, e.model_name
    INTO v_item
    FROM public.rental_order_items roi
    JOIN public.equipment e ON e.id = roi.equipment_id
    WHERE roi.id = p_order_item_id;

    IF v_item.id IS NULL THEN
        RAISE EXCEPTION 'Entity Not Found: Order item % does not exist.', p_order_item_id;
    END IF;

    IF v_item.item_status <> 'dispatched' THEN
        RAISE EXCEPTION 'Invalid State Transition: Item is in "%" status, cannot be returned.', v_item.item_status;
    END IF;

    v_final_hours := GREATEST(COALESCE(p_return_odometer, 0), COALESCE(v_item.dispatch_odometer_hours, 0));
    v_parent_order_id := v_item.rental_order_id;

    -- Damage is strictly determined by explicit condition rating (p_integrity <= 2 means Damaged; 5 means Okay)
    v_has_damage := (COALESCE(p_integrity, 5) <= 2);
    v_new_item_status := CASE
        WHEN v_has_damage THEN 'damaged'::public.item_rental_status
        ELSE 'returned'::public.item_rental_status
    END;

    INSERT INTO public.equipment_inspections (
        rental_order_item_id, inspector_id, inspection_type, fuel_level_percent,
        odometer_reading, cleanliness_rating, structural_integrity_rating,
        damage_identified, damage_assessment_notes, penalty_fee, sign_off_status
    ) VALUES (
        p_order_item_id,
        v_effective_inspector,
        'post_return',
        LEAST(GREATEST(COALESCE(p_fuel_level, 100), 0), 100),
        v_final_hours,
        LEAST(GREATEST(COALESCE(p_cleanliness, CASE WHEN v_has_damage THEN 2 ELSE 5 END), 1), 5),
        LEAST(GREATEST(COALESCE(p_integrity, 5), 1), 5),
        v_has_damage,
        NULLIF(trim(COALESCE(p_damage_notes, '')), ''),
        COALESCE(p_penalty_fee, 0.00),
        TRUE
    );

    -- Updating item_status fires trg_sync_equipment_status:
    -- 'returned' -> equipment becomes 'available'
    -- 'damaged'  -> equipment becomes 'under_maintenance'
    UPDATE public.rental_order_items
    SET item_status = v_new_item_status,
        return_odometer_hours = v_final_hours,
        returned_at = NOW(),
        condition_notes = NULLIF(trim(COALESCE(p_damage_notes, '')), '')
    WHERE id = p_order_item_id;

    -- Only create a Maintenance Queue work order if returned as Damaged
    IF v_has_damage THEN
        INSERT INTO public.maintenance_records (
            work_order_number, equipment_id, maintenance_type, maintenance_status,
            scheduled_date, odometer_hours_at_service, lead_technician_id, service_description
        ) VALUES (
            'WO-' || to_char(NOW(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6)),
            v_item.equipment_id,
            'emergency_repair'::public.maintenance_type_enum,
            'pending'::public.maintenance_status_enum,
            CURRENT_DATE,
            v_final_hours,
            v_effective_inspector,
            'Returned damaged: ' || COALESCE(NULLIF(trim(p_damage_notes), ''), 'Requires inspection & repair before next rental')
        ) RETURNING id INTO v_maintenance_id;

        v_maintenance_created := TRUE;
    END IF;

    SELECT COUNT(*) INTO v_remaining_dispatched
    FROM public.rental_order_items
    WHERE rental_order_id = v_parent_order_id AND item_status = 'dispatched';

    IF v_remaining_dispatched = 0 THEN
        UPDATE public.rental_orders
        SET status = 'completed', actual_return_date = CURRENT_DATE, updated_at = NOW()
        WHERE id = v_parent_order_id;
    END IF;

    v_result := jsonb_build_object(
        'success', true,
        'item_id', p_order_item_id,
        'equipment_id', v_item.equipment_id,
        'item_status', v_new_item_status,
        'damage_flag', v_has_damage,
        'penalty_fee', COALESCE(p_penalty_fee, 0),
        'parent_order_completed', (v_remaining_dispatched = 0),
        'maintenance_work_order_created', v_maintenance_created,
        'maintenance_record_id', v_maintenance_id
    );

    RETURN v_result;
END;
$$;

-- Trigger & Stored Procedure: Marking maintenance as completed automatically makes equipment 'available'
CREATE OR REPLACE FUNCTION public.fn_sync_maintenance_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_open_maint_count INT;
    v_active_dispatch_count INT;
BEGIN
    IF NEW.maintenance_status = 'completed' AND (OLD.maintenance_status IS DISTINCT FROM 'completed') THEN
        SELECT COUNT(*) INTO v_open_maint_count
        FROM public.maintenance_records
        WHERE equipment_id = NEW.equipment_id
          AND id <> NEW.id
          AND maintenance_status IN ('pending', 'in_progress');

        SELECT COUNT(*) INTO v_active_dispatch_count
        FROM public.rental_order_items
        WHERE equipment_id = NEW.equipment_id
          AND item_status = 'dispatched';

        IF v_open_maint_count = 0 AND v_active_dispatch_count = 0 THEN
            UPDATE public.equipment
            SET current_status = 'available',
                updated_at = NOW()
            WHERE id = NEW.equipment_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_maintenance_completion ON public.maintenance_records;
CREATE TRIGGER trg_sync_maintenance_completion
AFTER UPDATE OF maintenance_status ON public.maintenance_records
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_maintenance_completion();

CREATE OR REPLACE FUNCTION public.sp_complete_maintenance_repair(p_maintenance_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_equip_id UUID;
BEGIN
    IF public.fn_current_user_role() NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'Authorization Error: Only staff or administrators can complete maintenance repairs.';
    END IF;

    UPDATE public.maintenance_records
    SET maintenance_status = 'completed',
        completed_date = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = p_maintenance_id
    RETURNING equipment_id INTO v_equip_id;

    IF v_equip_id IS NULL THEN
        RAISE EXCEPTION 'Maintenance work order % not found.', p_maintenance_id;
    END IF;

    UPDATE public.equipment
    SET current_status = 'available',
        updated_at = NOW()
    WHERE id = v_equip_id
      AND NOT EXISTS (
          SELECT 1 FROM public.rental_order_items roi
          WHERE roi.equipment_id = v_equip_id AND roi.item_status = 'dispatched'
      );

    RETURN jsonb_build_object(
        'success', true,
        'maintenance_id', p_maintenance_id,
        'equipment_id', v_equip_id,
        'new_equipment_status', 'available'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sp_complete_maintenance_repair(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. CONVERT HEAVY MACHINERY TO CAMERAS, LENSES, LIGHTING & AUDIO EQUIPMENT
--    Preserves existing UUIDs/orders while populating clean Camera & Studio gear
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_wh_id UUID;
    v_cat_cameras UUID;
    v_cat_lenses UUID;
    v_cat_lighting UUID;
    v_cat_audio UUID;
    v_cat_stabilizers UUID;
    v_rec RECORD;
    v_idx INT := 0;
BEGIN
    -- Ensure at least one studio hub location exists
    SELECT id INTO v_wh_id FROM public.warehouse_locations ORDER BY created_at LIMIT 1;
    IF v_wh_id IS NULL THEN
        INSERT INTO public.warehouse_locations (
            branch_code, branch_name, address, city, region, contact_phone, max_storage_capacity
        ) VALUES (
            'MNL-STUDIO-01',
            'EquipRent Main Studio Hub',
            '128 Scout Borromeo St., Diliman',
            'Quezon City',
            'Metro Manila',
            '+63 917 555 0199',
            250
        ) RETURNING id INTO v_wh_id;
    END IF;

    -- Upsert Camera & Production Categories
    INSERT INTO public.equipment_categories (category_name, category_code, description, base_daily_insurance_rate, requires_operator_certification)
    VALUES ('Cameras', 'CAM', 'Mirrorless, DSLR, and cinema camera bodies', 250.00, FALSE)
    ON CONFLICT (category_code) DO UPDATE SET category_name = EXCLUDED.category_name, description = EXCLUDED.description, base_daily_insurance_rate = EXCLUDED.base_daily_insurance_rate
    RETURNING id INTO v_cat_cameras;

    INSERT INTO public.equipment_categories (category_name, category_code, description, base_daily_insurance_rate, requires_operator_certification)
    VALUES ('Camera Lenses', 'LENS', 'Prime and zoom lenses for photo and cinema', 180.00, FALSE)
    ON CONFLICT (category_code) DO UPDATE SET category_name = EXCLUDED.category_name, description = EXCLUDED.description, base_daily_insurance_rate = EXCLUDED.base_daily_insurance_rate
    RETURNING id INTO v_cat_lenses;

    INSERT INTO public.equipment_categories (category_name, category_code, description, base_daily_insurance_rate, requires_operator_certification)
    VALUES ('Studio Lighting', 'LIGHT', 'LED panels, strobes, softboxes, and light modifiers', 120.00, FALSE)
    ON CONFLICT (category_code) DO UPDATE SET category_name = EXCLUDED.category_name, description = EXCLUDED.description, base_daily_insurance_rate = EXCLUDED.base_daily_insurance_rate
    RETURNING id INTO v_cat_lighting;

    INSERT INTO public.equipment_categories (category_name, category_code, description, base_daily_insurance_rate, requires_operator_certification)
    VALUES ('Audio & Microphones', 'AUDIO', 'Wireless lavaliers, shotgun mics, and field recorders', 100.00, FALSE)
    ON CONFLICT (category_code) DO UPDATE SET category_name = EXCLUDED.category_name, description = EXCLUDED.description, base_daily_insurance_rate = EXCLUDED.base_daily_insurance_rate
    RETURNING id INTO v_cat_audio;

    INSERT INTO public.equipment_categories (category_name, category_code, description, base_daily_insurance_rate, requires_operator_certification)
    VALUES ('Gimbals & Drones', 'STAB', 'Motorized gimbals, tripods, and aerial camera drones', 300.00, FALSE)
    ON CONFLICT (category_code) DO UPDATE SET category_name = EXCLUDED.category_name, description = EXCLUDED.description, base_daily_insurance_rate = EXCLUDED.base_daily_insurance_rate
    RETURNING id INTO v_cat_stabilizers;

    -- Convert any existing heavy-machinery equipment rows in-place (keeps existing orders intact!)
    FOR v_rec IN
        SELECT id FROM public.equipment
        WHERE model_name ILIKE '%excavator%'
           OR model_name ILIKE '%bulldozer%'
           OR model_name ILIKE '%forklift%'
           OR model_name ILIKE '%loader%'
           OR model_name ILIKE '%crane%'
           OR model_name ILIKE '%roller%'
           OR model_name ILIKE '%generator%'
           OR model_name ILIKE '%backhoe%'
           OR model_name ILIKE '%dump%'
           OR model_name ILIKE '%tractor%'
           OR manufacturer ILIKE '%caterpillar%'
           OR manufacturer ILIKE '%komatsu%'
           OR manufacturer ILIKE '%jcb%'
           OR manufacturer ILIKE '%volvo%'
           OR manufacturer ILIKE '%john deere%'
           OR manufacturer ILIKE '%bobcat%'
        ORDER BY created_at
    LOOP
        v_idx := v_idx + 1;
        IF v_idx = 1 THEN
            UPDATE public.equipment SET
                model_name = 'Sony Alpha A7 IV Mirrorless Camera',
                manufacturer = 'Sony',
                serial_number = 'SN-A74-' || substr(id::text, 1, 6),
                category_id = v_cat_cameras,
                daily_rental_rate = 2500.00,
                replacement_value = 145000.00,
                image_url = 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=80'
            WHERE id = v_rec.id;
        ELSIF v_idx = 2 THEN
            UPDATE public.equipment SET
                model_name = 'Canon EOS R6 Mark II Camera Body',
                manufacturer = 'Canon',
                serial_number = 'CN-R6M2-' || substr(id::text, 1, 6),
                category_id = v_cat_cameras,
                daily_rental_rate = 2400.00,
                replacement_value = 140000.00,
                image_url = 'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?auto=format&fit=crop&w=900&q=80'
            WHERE id = v_rec.id;
        ELSIF v_idx = 3 THEN
            UPDATE public.equipment SET
                model_name = 'Sony FE 24-70mm f/2.8 GM II Lens',
                manufacturer = 'Sony',
                serial_number = 'SN-2470GM-' || substr(id::text, 1, 6),
                category_id = v_cat_lenses,
                daily_rental_rate = 1200.00,
                replacement_value = 115000.00,
                image_url = 'https://images.unsplash.com/photo-1617005082133-548c4dd27f35?auto=format&fit=crop&w=900&q=80'
            WHERE id = v_rec.id;
        ELSIF v_idx = 4 THEN
            UPDATE public.equipment SET
                model_name = 'Aputure Amaran 200x S LED Studio Light',
                manufacturer = 'Aputure',
                serial_number = 'AP-200XS-' || substr(id::text, 1, 6),
                category_id = v_cat_lighting,
                daily_rental_rate = 850.00,
                replacement_value = 24000.00,
                image_url = 'https://images.unsplash.com/photo-1524143986875-3b098d78b363?auto=format&fit=crop&w=900&q=80'
            WHERE id = v_rec.id;
        ELSIF v_idx = 5 THEN
            UPDATE public.equipment SET
                model_name = 'DJI RS 3 Pro Gimbal Stabilizer',
                manufacturer = 'DJI',
                serial_number = 'DJI-RS3P-' || substr(id::text, 1, 6),
                category_id = v_cat_stabilizers,
                daily_rental_rate = 950.00,
                replacement_value = 48000.00,
                image_url = 'https://images.unsplash.com/photo-1589872307379-0ffdf9829123?auto=format&fit=crop&w=900&q=80'
            WHERE id = v_rec.id;
        ELSE
            UPDATE public.equipment SET
                model_name = 'Rode Wireless PRO Dual Mic Kit #' || v_idx,
                manufacturer = 'Rode',
                serial_number = 'RD-WPRO-' || substr(id::text, 1, 6),
                category_id = v_cat_audio,
                daily_rental_rate = 650.00,
                replacement_value = 22000.00,
                image_url = 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?auto=format&fit=crop&w=900&q=80'
            WHERE id = v_rec.id;
        END IF;
    END LOOP;

    -- Seed Camera & Studio Equipment items if they do not exist yet
    INSERT INTO public.equipment (
        serial_number, model_name, manufacturer, model_year, category_id, warehouse_id,
        daily_rental_rate, replacement_value, current_status, image_url
    ) VALUES
    (
        'CAM-SN-A7IV-01',
        'Sony Alpha A7 IV Mirrorless Camera',
        'Sony',
        2024,
        v_cat_cameras,
        v_wh_id,
        2500.00,
        145000.00,
        'available',
        'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=80'
    ),
    (
        'CAM-CN-R6M2-01',
        'Canon EOS R6 Mark II Camera Body',
        'Canon',
        2024,
        v_cat_cameras,
        v_wh_id,
        2400.00,
        140000.00,
        'available',
        'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?auto=format&fit=crop&w=900&q=80'
    ),
    (
        'LENS-SN-2470GM2',
        'Sony FE 24-70mm f/2.8 GM II Lens',
        'Sony',
        2024,
        v_cat_lenses,
        v_wh_id,
        1200.00,
        115000.00,
        'available',
        'https://images.unsplash.com/photo-1617005082133-548c4dd27f35?auto=format&fit=crop&w=900&q=80'
    ),
    (
        'LIGHT-AP-200XS-01',
        'Aputure Amaran 200x S LED Light Kit',
        'Aputure',
        2024,
        v_cat_lighting,
        v_wh_id,
        850.00,
        24000.00,
        'available',
        'https://images.unsplash.com/photo-1524143986875-3b098d78b363?auto=format&fit=crop&w=900&q=80'
    ),
    (
        'AUDIO-RD-WPRO-01',
        'Rode Wireless PRO Dual Mic System',
        'Rode',
        2024,
        v_cat_audio,
        v_wh_id,
        650.00,
        22000.00,
        'available',
        'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?auto=format&fit=crop&w=900&q=80'
    ),
    (
        'STAB-DJI-RS3P-01',
        'DJI RS 3 Pro Gimbal Stabilizer',
        'DJI',
        2024,
        v_cat_stabilizers,
        v_wh_id,
        950.00,
        48000.00,
        'available',
        'https://images.unsplash.com/photo-1589872307379-0ffdf9829123?auto=format&fit=crop&w=900&q=80'
    )
    ON CONFLICT (serial_number) DO NOTHING;

    -- Remove unused old heavy-machinery categories that have zero equipment referencing them
    DELETE FROM public.equipment_categories ec
    WHERE ec.category_code NOT IN ('CAM', 'LENS', 'LIGHT', 'AUDIO', 'STAB')
      AND NOT EXISTS (SELECT 1 FROM public.equipment e WHERE e.category_id = ec.id);
END;
$$;

-- Reload Supabase PostgREST schema cache so new/updated RPCs work immediately
NOTIFY pgrst, 'reload schema';

