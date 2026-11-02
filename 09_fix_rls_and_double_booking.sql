-- ============================================================================
-- EQUIPRENT DATABASE ENGINEERING SPECIFICATION
-- MIGRATION 09: FIX CUSTOMER RESERVATION RLS, STRICT CUSTOMER ISOLATION,
--               DOUBLE-BOOKING PREVENTION & ADMIN USER MANAGEMENT
-- Safe to run on an EXISTING Supabase project (preserves all existing data).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. IDENTITY & ROLE HELPER FUNCTIONS (SECURITY DEFINER)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_current_profile_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    SELECT id INTO v_profile_id
    FROM public.user_profiles
    WHERE auth_user_id = auth.uid()
       OR id = auth.uid()
    LIMIT 1;

    RETURN v_profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_current_user_role()
RETURNS public.user_role_type
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role public.user_role_type;
BEGIN
    SELECT role INTO v_role
    FROM public.user_profiles
    WHERE auth_user_id = auth.uid()
       OR id = auth.uid()
    LIMIT 1;

    RETURN COALESCE(v_role, 'customer'::public.user_role_type);
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. OPERATIONAL TRIGGERS (SECURITY DEFINER + STRICT DOUBLE-BOOKING GUARD)
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
            SET current_status = 'rented'
            WHERE id = NEW.equipment_id;
        ELSIF NEW.item_status = 'returned' THEN
            IF NEW.condition_notes ILIKE '%damage%' OR NEW.condition_notes ILIKE '%repair%' THEN
                UPDATE public.equipment
                SET current_status = 'under_maintenance',
                    operational_hours = COALESCE(NEW.return_odometer_hours, operational_hours)
                WHERE id = NEW.equipment_id;
            ELSE
                UPDATE public.equipment
                SET current_status = 'available',
                    operational_hours = COALESCE(NEW.return_odometer_hours, operational_hours)
                WHERE id = NEW.equipment_id;
            END IF;
        ELSIF NEW.item_status = 'damaged' THEN
            UPDATE public.equipment
            SET current_status = 'under_maintenance',
                operational_hours = COALESCE(NEW.return_odometer_hours, operational_hours)
            WHERE id = NEW.equipment_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_recalculate_order_financials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_id UUID;
    v_new_subtotal NUMERIC(12, 2) := 0.00;
    v_new_insurance NUMERIC(12, 2) := 0.00;
    v_new_tax NUMERIC(12, 2) := 0.00;
    v_tax_rate NUMERIC(4, 2) := 0.08;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        v_order_id := OLD.rental_order_id;
    ELSE
        v_order_id := NEW.rental_order_id;
    END IF;

    SELECT COALESCE(SUM(item_subtotal), 0.00),
           COALESCE(SUM(daily_insurance_rate * days_rented), 0.00)
    INTO v_new_subtotal, v_new_insurance
    FROM public.rental_order_items
    WHERE rental_order_id = v_order_id;

    v_new_tax := ROUND((v_new_subtotal + v_new_insurance) * v_tax_rate, 2);

    UPDATE public.rental_orders
    SET subtotal_amount = v_new_subtotal,
        insurance_amount = v_new_insurance,
        tax_amount = v_new_tax,
        total_amount = v_new_subtotal + v_new_insurance + v_new_tax + security_deposit_amount,
        updated_at = NOW()
    WHERE id = v_order_id;

    RETURN NULL;
END;
$$;

-- Prevents overlapping bookings across ALL customer accounts (including pending 'draft',
-- 'confirmed', and 'in_progress' reservations) with row-level concurrency locking.
CREATE OR REPLACE FUNCTION public.fn_guard_prevent_double_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_start DATE;
    v_order_end DATE;
    v_order_status public.rental_order_status;
    v_collision_count INT;
    v_maint_collision_count INT;
    v_equip_status public.equipment_status_type;
BEGIN
    -- Lock equipment row to prevent race-condition double bookings at the same instant
    SELECT current_status INTO v_equip_status
    FROM public.equipment
    WHERE id = NEW.equipment_id
    FOR UPDATE;

    IF v_equip_status = 'decommissioned' THEN
        RAISE EXCEPTION 'Database Integrity Error: Equipment % is decommissioned and cannot be rented.', NEW.equipment_id;
    END IF;

    IF NEW.item_status NOT IN ('reserved', 'dispatched') THEN
        RETURN NEW;
    END IF;

    SELECT expected_start_date, expected_end_date, status
    INTO v_order_start, v_order_end, v_order_status
    FROM public.rental_orders
    WHERE id = NEW.rental_order_id;

    IF v_order_status IN ('cancelled', 'completed') THEN
        RETURN NEW;
    END IF;

    SELECT COUNT(*) INTO v_collision_count
    FROM public.rental_order_items roi
    JOIN public.rental_orders ro ON ro.id = roi.rental_order_id
    WHERE roi.equipment_id = NEW.equipment_id
      AND roi.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
      AND roi.item_status IN ('reserved', 'dispatched')
      AND ro.status IN ('draft', 'confirmed', 'in_progress')
      AND ((ro.expected_start_date <= v_order_end) AND (ro.expected_end_date >= v_order_start));

    IF v_collision_count > 0 THEN
        RAISE EXCEPTION 'Double-Booking Violation: This equipment is already reserved or rented for overlapping dates (% to %).',
            v_order_start, v_order_end;
    END IF;

    SELECT COUNT(*) INTO v_maint_collision_count
    FROM public.maintenance_records mr
    WHERE mr.equipment_id = NEW.equipment_id
      AND mr.maintenance_status IN ('pending', 'in_progress')
      AND mr.scheduled_date BETWEEN v_order_start AND v_order_end;

    IF v_maint_collision_count > 0 THEN
        RAISE EXCEPTION 'Maintenance Conflict: This equipment has scheduled maintenance during (% to %).',
            v_order_start, v_order_end;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_double_booking ON public.rental_order_items;
CREATE TRIGGER trg_guard_double_booking
BEFORE INSERT OR UPDATE OF equipment_id, rental_order_id, item_status
ON public.rental_order_items
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_prevent_double_booking();

-- Also guard parent order date/status updates against overlapping reservations
CREATE OR REPLACE FUNCTION public.fn_guard_order_update_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_collision_count INT;
BEGIN
    IF NEW.status IN ('draft', 'confirmed', 'in_progress') THEN
        SELECT COUNT(*) INTO v_collision_count
        FROM public.rental_order_items my_item
        JOIN public.rental_order_items other_item
          ON other_item.equipment_id = my_item.equipment_id
         AND other_item.rental_order_id <> NEW.id
        JOIN public.rental_orders other_order
          ON other_order.id = other_item.rental_order_id
        WHERE my_item.rental_order_id = NEW.id
          AND my_item.item_status IN ('reserved', 'dispatched')
          AND other_item.item_status IN ('reserved', 'dispatched')
          AND other_order.status IN ('draft', 'confirmed', 'in_progress')
          AND ((other_order.expected_start_date <= NEW.expected_end_date)
               AND (other_order.expected_end_date >= NEW.expected_start_date));

        IF v_collision_count > 0 THEN
            RAISE EXCEPTION 'Double-Booking Violation: Another active or pending reservation already covers (% to %).',
                NEW.expected_start_date, NEW.expected_end_date;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_order_update_overlap ON public.rental_orders;
CREATE TRIGGER trg_guard_order_update_overlap
BEFORE UPDATE OF status, expected_start_date, expected_end_date
ON public.rental_orders
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_order_update_overlap();

-- ----------------------------------------------------------------------------
-- 3. PRIVACY-SAFE CALENDAR AVAILABILITY & SECURE ADMIN/STAFF RPCs
-- ----------------------------------------------------------------------------

-- Exposes ONLY anonymized unavailable date ranges (zero customer PII or order details)
CREATE OR REPLACE FUNCTION public.fn_get_equipment_booked_ranges()
RETURNS TABLE (
    equipment_id UUID,
    start_date DATE,
    end_date DATE,
    block_type TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    SELECT
        roi.equipment_id,
        ro.expected_start_date AS start_date,
        ro.expected_end_date AS end_date,
        CASE
            WHEN ro.status = 'in_progress' OR roi.item_status = 'dispatched' THEN 'rented'::TEXT
            ELSE 'reserved'::TEXT
        END AS block_type
    FROM public.rental_order_items roi
    JOIN public.rental_orders ro ON ro.id = roi.rental_order_id
    WHERE ro.status IN ('draft', 'confirmed', 'in_progress')
      AND roi.item_status IN ('reserved', 'dispatched')
    UNION ALL
    SELECT
        mr.equipment_id,
        mr.scheduled_date AS start_date,
        COALESCE(mr.completed_date, mr.scheduled_date) AS end_date,
        'maintenance'::TEXT AS block_type
    FROM public.maintenance_records mr
    WHERE mr.maintenance_status IN ('pending', 'in_progress');
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_equipment_booked_ranges() TO authenticated;

-- Harden checkout & return stored procedures to verify caller session role
CREATE OR REPLACE FUNCTION public.sp_process_rental_checkout(
    p_order_id UUID,
    p_staff_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.rental_order_status;
    v_staff_role public.user_role_type;
    v_item RECORD;
    v_unavailable_item_count INT;
    v_dispatched_items_count INT := 0;
    v_result JSONB;
BEGIN
    IF public.fn_current_user_role() NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'Authorization Error: Current session is not authorized to dispatch equipment.';
    END IF;

    SELECT role INTO v_staff_role FROM public.user_profiles WHERE id = p_staff_id;
    IF v_staff_role IS NULL OR v_staff_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'Authorization Error: User % is not authorized to dispatch equipment.', p_staff_id;
    END IF;

    SELECT status INTO v_order_status FROM public.rental_orders WHERE id = p_order_id;
    IF v_order_status IS NULL THEN
        RAISE EXCEPTION 'Entity Not Found: Order % does not exist.', p_order_id;
    END IF;

    IF v_order_status NOT IN ('draft', 'confirmed') THEN
        RAISE EXCEPTION 'Invalid State Transition: Cannot checkout order with status "%".', v_order_status;
    END IF;

    SELECT COUNT(*) INTO v_unavailable_item_count
    FROM public.rental_order_items roi
    JOIN public.equipment e ON e.id = roi.equipment_id
    WHERE roi.rental_order_id = p_order_id
      AND e.current_status <> 'available';

    IF v_unavailable_item_count > 0 THEN
        RAISE EXCEPTION 'Equipment Allocation Conflict: % unit(s) are currently not available.', v_unavailable_item_count;
    END IF;

    FOR v_item IN
        SELECT roi.id AS item_id, roi.equipment_id, e.operational_hours
        FROM public.rental_order_items roi
        JOIN public.equipment e ON e.id = roi.equipment_id
        WHERE roi.rental_order_id = p_order_id
    LOOP
        UPDATE public.rental_order_items
        SET item_status = 'dispatched',
            dispatch_odometer_hours = v_item.operational_hours,
            dispatched_at = NOW()
        WHERE id = v_item.item_id;

        v_dispatched_items_count := v_dispatched_items_count + 1;
    END LOOP;

    UPDATE public.rental_orders
    SET status = 'in_progress',
        authorized_staff_id = p_staff_id,
        updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
        'success', true,
        'order_id', p_order_id,
        'new_status', 'in_progress',
        'dispatched_by', p_staff_id,
        'items_dispatched_count', v_dispatched_items_count,
        'dispatched_at', NOW()
    );

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.sp_process_equipment_return(
    p_order_item_id UUID,
    p_return_odometer NUMERIC,
    p_fuel_level INT,
    p_cleanliness INT,
    p_integrity INT,
    p_inspector_id UUID,
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
    v_inspector_role public.user_role_type;
    v_has_damage BOOLEAN := FALSE;
    v_new_item_status public.item_rental_status;
    v_parent_order_id UUID;
    v_remaining_dispatched INT;
    v_maintenance_created BOOLEAN := FALSE;
    v_maintenance_id UUID := NULL;
    v_result JSONB;
BEGIN
    IF public.fn_current_user_role() NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'Authorization Error: Current session is not authorized to process returns.';
    END IF;

    SELECT role INTO v_inspector_role FROM public.user_profiles WHERE id = p_inspector_id;
    IF v_inspector_role IS NULL OR v_inspector_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'Authorization Error: Inspector % is not authorized.', p_inspector_id;
    END IF;

    SELECT roi.*, e.maintenance_interval_hours, e.model_name
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

    IF p_return_odometer < COALESCE(v_item.dispatch_odometer_hours, 0) THEN
        RAISE EXCEPTION 'Odometer Validation Error: Return hours cannot be less than dispatch hours.';
    END IF;

    v_parent_order_id := v_item.rental_order_id;
    v_has_damage := (p_integrity <= 2 OR (p_damage_notes IS NOT NULL AND length(trim(p_damage_notes)) > 0) OR p_penalty_fee > 0);
    v_new_item_status := CASE WHEN v_has_damage THEN 'damaged'::public.item_rental_status ELSE 'returned'::public.item_rental_status END;

    INSERT INTO public.equipment_inspections (
        rental_order_item_id, inspector_id, inspection_type, fuel_level_percent,
        odometer_reading, cleanliness_rating, structural_integrity_rating,
        damage_identified, damage_assessment_notes, penalty_fee, sign_off_status
    ) VALUES (
        p_order_item_id, p_inspector_id, 'post_return', p_fuel_level,
        p_return_odometer, p_cleanliness, p_integrity,
        v_has_damage, p_damage_notes, COALESCE(p_penalty_fee, 0.00), TRUE
    );

    UPDATE public.rental_order_items
    SET item_status = v_new_item_status,
        return_odometer_hours = p_return_odometer,
        returned_at = NOW(),
        condition_notes = p_damage_notes
    WHERE id = p_order_item_id;

    IF v_has_damage OR (p_return_odometer >= v_item.maintenance_interval_hours) THEN
        INSERT INTO public.maintenance_records (
            work_order_number, equipment_id, maintenance_type, maintenance_status,
            scheduled_date, odometer_hours_at_service, lead_technician_id, service_description
        ) VALUES (
            'WO-' || to_char(NOW(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6),
            v_item.equipment_id,
            CASE WHEN v_has_damage THEN 'emergency_repair'::public.maintenance_type_enum ELSE 'scheduled_routine'::public.maintenance_type_enum END,
            'pending'::public.maintenance_status_enum,
            CURRENT_DATE, p_return_odometer, p_inspector_id,
            CASE WHEN v_has_damage
                THEN 'Post-return damage repair: ' || COALESCE(p_damage_notes, 'Physical inspection failure')
                ELSE 'Routine service milestone exceeded (' || p_return_odometer || ' hours logged)'
            END
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
        'penalty_fee', p_penalty_fee,
        'parent_order_completed', (v_remaining_dispatched = 0),
        'maintenance_work_order_created', v_maintenance_created,
        'maintenance_record_id', v_maintenance_id
    );

    RETURN v_result;
END;
$$;

-- Admin-only RPCs for Staff Provisioning & User Removal (preserves strict column grants on user_profiles)
CREATE OR REPLACE FUNCTION public.sp_admin_upsert_staff_profile(
    p_auth_user_id UUID,
    p_full_name TEXT,
    p_email TEXT,
    p_phone TEXT,
    p_company_name TEXT DEFAULT 'EquipRent Operations'
)
RETURNS public.user_profiles
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
        COALESCE(NULLIF(trim(p_company_name), ''), 'EquipRent Operations'),
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

    RETURN v_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.sp_admin_delete_user_profile(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_target_role public.user_role_type;
BEGIN
    IF public.fn_current_user_role() <> 'admin' THEN
        RAISE EXCEPTION 'Authorization Error: Only administrators can remove user accounts.';
    END IF;

    SELECT role INTO v_target_role FROM public.user_profiles WHERE id = p_user_id;
    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'User profile not found.';
    END IF;

    IF v_target_role = 'admin' THEN
        RAISE EXCEPTION 'Action Denied: Administrator accounts cannot be removed.';
    END IF;

    DELETE FROM public.user_profiles WHERE id = p_user_id;
EXCEPTION
    WHEN foreign_key_violation THEN
        RAISE EXCEPTION 'Cannot remove this user because they have linked rental orders or inspection records.';
END;
$$;

GRANT EXECUTE ON FUNCTION public.sp_admin_upsert_staff_profile(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sp_admin_delete_user_profile(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. ENFORCE SECURITY INVOKER ON VIEWS & REBUILD STRICT RLS POLICIES
-- ----------------------------------------------------------------------------
ALTER VIEW IF EXISTS public.vw_equipment_catalog SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_active_rentals_dashboard SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_maintenance_schedule_overview SET (security_invoker = true);

-- Ensure authenticated role has required table-level privileges governed by RLS
GRANT SELECT ON public.equipment_categories, public.warehouse_locations, public.equipment TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.equipment, public.equipment_categories, public.warehouse_locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_orders, public.rental_order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_transactions, public.maintenance_records, public.maintenance_tasks, public.equipment_inspections TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

-- Remove unsafe anonymous read policies on private operational tables
DROP POLICY IF EXISTS pol_anon_orders_select ON public.rental_orders;
DROP POLICY IF EXISTS pol_anon_items_select ON public.rental_order_items;
DROP POLICY IF EXISTS pol_anon_maintenance_select ON public.maintenance_records;
DROP POLICY IF EXISTS pol_anon_inspections_select ON public.equipment_inspections;
DROP POLICY IF EXISTS pol_anon_audit_select ON public.audit_logs;
DROP POLICY IF EXISTS pol_anon_profiles_select ON public.user_profiles;

-- Rebuild equipment/category/warehouse admin & staff policies
DROP POLICY IF EXISTS pol_equipment_staff_modify ON public.equipment;
DROP POLICY IF EXISTS pol_equipment_admin_crud ON public.equipment;
CREATE POLICY pol_equipment_staff_modify ON public.equipment
    FOR ALL TO authenticated
    USING (public.fn_current_user_role() IN ('admin', 'staff'))
    WITH CHECK (public.fn_current_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS pol_categories_admin_all ON public.equipment_categories;
CREATE POLICY pol_categories_admin_all ON public.equipment_categories
    FOR ALL TO authenticated
    USING (public.fn_current_user_role() = 'admin')
    WITH CHECK (public.fn_current_user_role() = 'admin');

DROP POLICY IF EXISTS pol_warehouses_admin_all ON public.warehouse_locations;
CREATE POLICY pol_warehouses_admin_all ON public.warehouse_locations
    FOR ALL TO authenticated
    USING (public.fn_current_user_role() = 'admin')
    WITH CHECK (public.fn_current_user_role() = 'admin');

-- Rebuild Rental Orders RLS: Strict per-customer isolation + draft creation/cancellation
DROP POLICY IF EXISTS pol_orders_customer_select ON public.rental_orders;
DROP POLICY IF EXISTS pol_orders_customer_insert ON public.rental_orders;
DROP POLICY IF EXISTS pol_orders_customer_cancel ON public.rental_orders;
DROP POLICY IF EXISTS pol_orders_customer_delete_draft ON public.rental_orders;
DROP POLICY IF EXISTS pol_orders_staff_update ON public.rental_orders;

CREATE POLICY pol_orders_customer_select ON public.rental_orders
    FOR SELECT TO authenticated
    USING (
        customer_id = public.fn_current_profile_id()
        OR public.fn_current_user_role() IN ('admin', 'staff')
    );

CREATE POLICY pol_orders_customer_insert ON public.rental_orders
    FOR INSERT TO authenticated
    WITH CHECK (
        (customer_id = public.fn_current_profile_id() AND status = 'draft')
        OR public.fn_current_user_role() IN ('admin', 'staff')
    );

CREATE POLICY pol_orders_customer_cancel ON public.rental_orders
    FOR UPDATE TO authenticated
    USING (
        customer_id = public.fn_current_profile_id()
        AND status = 'draft'
    )
    WITH CHECK (
        customer_id = public.fn_current_profile_id()
        AND status = 'cancelled'
    );

CREATE POLICY pol_orders_customer_delete_draft ON public.rental_orders
    FOR DELETE TO authenticated
    USING (
        customer_id = public.fn_current_profile_id()
        AND status = 'draft'
    );

CREATE POLICY pol_orders_staff_update ON public.rental_orders
    FOR UPDATE TO authenticated
    USING (public.fn_current_user_role() IN ('admin', 'staff'))
    WITH CHECK (public.fn_current_user_role() IN ('admin', 'staff'));

-- Rebuild Rental Order Items RLS: Fixes "new row violates row-level security policy for table rental_order_items"
DROP POLICY IF EXISTS pol_order_items_select ON public.rental_order_items;
DROP POLICY IF EXISTS pol_order_items_customer_insert ON public.rental_order_items;
DROP POLICY IF EXISTS pol_order_items_staff_all ON public.rental_order_items;

CREATE POLICY pol_order_items_select ON public.rental_order_items
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.rental_orders ro
            WHERE ro.id = rental_order_items.rental_order_id
              AND (
                  ro.customer_id = public.fn_current_profile_id()
                  OR public.fn_current_user_role() IN ('admin', 'staff')
              )
        )
    );

CREATE POLICY pol_order_items_customer_insert ON public.rental_order_items
    FOR INSERT TO authenticated
    WITH CHECK (
        item_status = 'reserved'
        AND EXISTS (
            SELECT 1 FROM public.rental_orders ro
            WHERE ro.id = rental_order_items.rental_order_id
              AND ro.customer_id = public.fn_current_profile_id()
              AND ro.status = 'draft'
        )
    );

CREATE POLICY pol_order_items_staff_all ON public.rental_order_items
    FOR ALL TO authenticated
    USING (public.fn_current_user_role() IN ('admin', 'staff'))
    WITH CHECK (public.fn_current_user_role() IN ('admin', 'staff'));

-- Rebuild Payment Transactions RLS
DROP POLICY IF EXISTS pol_payments_select ON public.payment_transactions;
DROP POLICY IF EXISTS pol_payments_staff_all ON public.payment_transactions;

CREATE POLICY pol_payments_select ON public.payment_transactions
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.rental_orders ro
            WHERE ro.id = payment_transactions.rental_order_id
              AND (
                  ro.customer_id = public.fn_current_profile_id()
                  OR public.fn_current_user_role() IN ('admin', 'staff')
              )
        )
    );

CREATE POLICY pol_payments_staff_all ON public.payment_transactions
    FOR ALL TO authenticated
    USING (public.fn_current_user_role() IN ('admin', 'staff'))
    WITH CHECK (public.fn_current_user_role() IN ('admin', 'staff'));

-- Rebuild User Profiles RLS: Strict self-isolation for customers, read for staff/admin
REVOKE ALL ON TABLE public.user_profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.user_profiles TO authenticated;
GRANT UPDATE (full_name, phone, company_name, updated_at)
    ON TABLE public.user_profiles TO authenticated;

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

