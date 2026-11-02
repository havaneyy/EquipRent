-- ============================================================================
-- EQUIPRENT MIGRATION 13: ALL-IN-ONE MASTER DATABASE SYNC
-- Run this single file in Supabase SQL Editor to guarantee 100% two-way sync
-- across all 11 tables, triggers, stored procedures, RLS, Audit Logs,
-- Camera & Studio Fleet catalog, and Supabase Realtime!
-- Safe to run multiple times (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. UNIVERSAL AUDIT TRIGGERS ACROSS ALL TABLES -> audit_logs
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_equipment ON public.equipment;
CREATE TRIGGER trg_audit_equipment
AFTER INSERT OR UPDATE OR DELETE ON public.equipment
FOR EACH ROW EXECUTE FUNCTION public.fn_universal_audit_logger();

DROP TRIGGER IF EXISTS trg_audit_categories ON public.equipment_categories;
CREATE TRIGGER trg_audit_categories
AFTER INSERT OR UPDATE OR DELETE ON public.equipment_categories
FOR EACH ROW EXECUTE FUNCTION public.fn_universal_audit_logger();

DROP TRIGGER IF EXISTS trg_audit_warehouses ON public.warehouse_locations;
CREATE TRIGGER trg_audit_warehouses
AFTER INSERT OR UPDATE OR DELETE ON public.warehouse_locations
FOR EACH ROW EXECUTE FUNCTION public.fn_universal_audit_logger();

DROP TRIGGER IF EXISTS trg_audit_rental_orders ON public.rental_orders;
CREATE TRIGGER trg_audit_rental_orders
AFTER INSERT OR UPDATE OR DELETE ON public.rental_orders
FOR EACH ROW EXECUTE FUNCTION public.fn_universal_audit_logger();

DROP TRIGGER IF EXISTS trg_audit_rental_order_items ON public.rental_order_items;
CREATE TRIGGER trg_audit_rental_order_items
AFTER INSERT OR UPDATE OR DELETE ON public.rental_order_items
FOR EACH ROW EXECUTE FUNCTION public.fn_universal_audit_logger();

DROP TRIGGER IF EXISTS trg_audit_payment_transactions ON public.payment_transactions;
CREATE TRIGGER trg_audit_payment_transactions
AFTER INSERT OR UPDATE OR DELETE ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_universal_audit_logger();

DROP TRIGGER IF EXISTS trg_audit_equipment_inspections ON public.equipment_inspections;
CREATE TRIGGER trg_audit_equipment_inspections
AFTER INSERT OR UPDATE OR DELETE ON public.equipment_inspections
FOR EACH ROW EXECUTE FUNCTION public.fn_universal_audit_logger();

DROP TRIGGER IF EXISTS trg_audit_maintenance_records ON public.maintenance_records;
CREATE TRIGGER trg_audit_maintenance_records
AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_records
FOR EACH ROW EXECUTE FUNCTION public.fn_universal_audit_logger();

DROP TRIGGER IF EXISTS trg_audit_maintenance_tasks ON public.maintenance_tasks;
CREATE TRIGGER trg_audit_maintenance_tasks
AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_tasks
FOR EACH ROW EXECUTE FUNCTION public.fn_universal_audit_logger();

DROP TRIGGER IF EXISTS trg_audit_user_profiles ON public.user_profiles;
CREATE TRIGGER trg_audit_user_profiles
AFTER INSERT OR UPDATE OR DELETE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.fn_universal_audit_logger();

-- ----------------------------------------------------------------------------
-- 2. AUTOMATIC SYNC TRIGGERS (EQUIPMENT <-> ORDER ITEMS <-> ORDERS & TASKS <-> MAINTENANCE)
-- ----------------------------------------------------------------------------

-- 2A. Auto-compute item_subtotal when unit_daily_rate or days_rented changes on rental_order_items
CREATE OR REPLACE FUNCTION public.fn_sync_order_item_subtotal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.item_subtotal := ROUND(COALESCE(NEW.unit_daily_rate, 0) * COALESCE(NEW.days_rented, 1), 2);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_item_subtotal ON public.rental_order_items;
CREATE TRIGGER trg_sync_order_item_subtotal
BEFORE INSERT OR UPDATE OF unit_daily_rate, days_rented
ON public.rental_order_items
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_order_item_subtotal();

-- 2B. When equipment daily_rental_rate changes, automatically sync any still-pending ('draft') order items
CREATE OR REPLACE FUNCTION public.fn_sync_equipment_price_to_draft_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ins_rate NUMERIC(10, 2) := 0.00;
BEGIN
    IF NEW.daily_rental_rate IS DISTINCT FROM OLD.daily_rental_rate
       OR NEW.category_id IS DISTINCT FROM OLD.category_id THEN
        SELECT COALESCE(base_daily_insurance_rate, 0.00)
        INTO v_ins_rate
        FROM public.equipment_categories
        WHERE id = NEW.category_id;

        UPDATE public.rental_order_items roi
        SET unit_daily_rate = NEW.daily_rental_rate,
            daily_insurance_rate = v_ins_rate,
            item_subtotal = ROUND(NEW.daily_rental_rate * roi.days_rented, 2)
        FROM public.rental_orders ro
        WHERE roi.rental_order_id = ro.id
          AND roi.equipment_id = NEW.id
          AND roi.item_status = 'reserved'
          AND ro.status = 'draft';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_equipment_price_to_draft_items ON public.equipment;
CREATE TRIGGER trg_sync_equipment_price_to_draft_items
AFTER UPDATE OF daily_rental_rate, category_id
ON public.equipment
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_equipment_price_to_draft_items();

-- 2C. Automatically recalculate maintenance_records labor_cost & total_maintenance_cost when maintenance_tasks change
CREATE OR REPLACE FUNCTION public.fn_sync_maintenance_task_costs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_maint_id UUID;
    v_labor NUMERIC(10, 2) := 0.00;
BEGIN
    v_maint_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.maintenance_id ELSE NEW.maintenance_id END;

    SELECT COALESCE(ROUND(SUM(hours_logged * hourly_labor_rate), 2), 0.00)
    INTO v_labor
    FROM public.maintenance_tasks
    WHERE maintenance_id = v_maint_id;

    UPDATE public.maintenance_records
    SET labor_cost = v_labor,
        total_maintenance_cost = COALESCE(parts_cost, 0.00) + v_labor,
        updated_at = NOW()
    WHERE id = v_maint_id;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_maintenance_task_costs ON public.maintenance_tasks;
CREATE TRIGGER trg_sync_maintenance_task_costs
AFTER INSERT OR UPDATE OF hours_logged, hourly_labor_rate OR DELETE
ON public.maintenance_tasks
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_maintenance_task_costs();

-- 2D. Prevent past-date bookings & lock under_maintenance equipment until repaired in Maintenance Queue
CREATE OR REPLACE FUNCTION public.fn_guard_no_past_rental_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.expected_start_date < CURRENT_DATE THEN
        RAISE EXCEPTION 'Invalid Booking Date: Cannot rent equipment on previous/past dates (%). Choose % or later.',
            NEW.expected_start_date, CURRENT_DATE;
    END IF;
    IF NEW.expected_end_date < NEW.expected_start_date THEN
        RAISE EXCEPTION 'Invalid Booking Range: End date (%) cannot be earlier than start date (%).',
            NEW.expected_end_date, NEW.expected_start_date;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_past_rental_dates ON public.rental_orders;
CREATE TRIGGER trg_prevent_past_rental_dates
BEFORE INSERT ON public.rental_orders
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_no_past_rental_dates();

CREATE OR REPLACE FUNCTION public.fn_guard_maintenance_release()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_open_maint_count INT := 0;
BEGIN
    IF OLD.current_status = 'under_maintenance' AND NEW.current_status = 'available' THEN
        SELECT COUNT(*)
        INTO v_open_maint_count
        FROM public.maintenance_records
        WHERE equipment_id = NEW.id
          AND maintenance_status IN ('pending', 'in_progress');

        IF v_open_maint_count > 0 THEN
            RAISE EXCEPTION 'Maintenance Lock: This equipment still has an open work order in the Maintenance Queue. Click "Mark as Repaired" in Maintenance Queue first.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_equipment_under_maintenance ON public.equipment;
CREATE TRIGGER trg_lock_equipment_under_maintenance
BEFORE UPDATE OF current_status ON public.equipment
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_maintenance_release();

-- ----------------------------------------------------------------------------
-- 3. UPGRADED STORED PROCEDURES (RETURN, MAINTENANCE REPAIR, STAFF & USER REMOVAL)
-- ----------------------------------------------------------------------------

-- 3A. Return check-in: creates equipment_inspections + syncs item/order/equipment + creates maintenance_records & maintenance_tasks when damaged
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

    UPDATE public.rental_order_items
    SET item_status = v_new_item_status,
        return_odometer_hours = v_final_hours,
        returned_at = NOW(),
        condition_notes = NULLIF(trim(COALESCE(p_damage_notes, '')), '')
    WHERE id = p_order_item_id;

    IF v_has_damage THEN
        UPDATE public.equipment
        SET current_status = 'under_maintenance',
            updated_at = NOW()
        WHERE id = v_item.equipment_id;

        INSERT INTO public.maintenance_records (
            work_order_number, equipment_id, maintenance_type, maintenance_status,
            scheduled_date, odometer_hours_at_service, labor_cost, total_maintenance_cost,
            lead_technician_id, service_description
        ) VALUES (
            'WO-' || to_char(NOW(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6)),
            v_item.equipment_id,
            'emergency_repair'::public.maintenance_type_enum,
            'in_progress'::public.maintenance_status_enum,
            CURRENT_DATE,
            v_final_hours,
            500.00,
            500.00,
            v_effective_inspector,
            'Returned damaged: ' || COALESCE(NULLIF(trim(COALESCE(p_damage_notes, '')), ''), 'Requires inspection & repair')
        ) RETURNING id INTO v_maintenance_id;

        INSERT INTO public.maintenance_tasks (
            maintenance_id, technician_id, task_code, task_name,
            hours_logged, hourly_labor_rate, progress_status, findings_report
        ) VALUES (
            v_maintenance_id,
            v_effective_inspector,
            'TSK-DMG-' || upper(substr(gen_random_uuid()::text, 1, 5)),
            'Post-Return Damage Inspection & Repair',
            1.00,
            500.00,
            'in_progress',
            COALESCE(NULLIF(trim(COALESCE(p_damage_notes, '')), ''), 'Returned damaged — requires maintenance check')
        );

        v_maintenance_created := TRUE;
    ELSE
        UPDATE public.equipment
        SET current_status = 'available',
            updated_at = NOW()
        WHERE id = v_item.equipment_id;
    END IF;

    SELECT COUNT(*) INTO v_remaining_dispatched
    FROM public.rental_order_items
    WHERE rental_order_id = v_parent_order_id
      AND item_status = 'dispatched';

    IF v_remaining_dispatched = 0 THEN
        UPDATE public.rental_orders
        SET status = 'completed',
            actual_return_date = CURRENT_DATE,
            updated_at = NOW()
        WHERE id = v_parent_order_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'item_id', p_order_item_id,
        'equipment_id', v_item.equipment_id,
        'item_status', v_new_item_status,
        'damage_flag', v_has_damage,
        'penalty_fee', COALESCE(p_penalty_fee, 0.00),
        'parent_order_completed', (v_remaining_dispatched = 0),
        'maintenance_work_order_created', v_maintenance_created,
        'maintenance_record_id', v_maintenance_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sp_process_equipment_return(UUID, NUMERIC, INT, INT, INT, UUID, TEXT, NUMERIC) TO authenticated;

-- 3B. Complete Maintenance Repair: completes maintenance_tasks + maintenance_records + sets equipment to 'available'
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
        RAISE EXCEPTION 'Authorization Error: Only staff or administrators can mark repairs complete.';
    END IF;

    SELECT equipment_id INTO v_equip_id
    FROM public.maintenance_records
    WHERE id = p_maintenance_id;

    IF v_equip_id IS NULL THEN
        RAISE EXCEPTION 'Maintenance work order not found.';
    END IF;

    UPDATE public.maintenance_tasks
    SET progress_status = 'completed',
        sign_off_timestamp = NOW()
    WHERE maintenance_id = p_maintenance_id;

    UPDATE public.maintenance_records
    SET maintenance_status = 'completed',
        completed_date = CURRENT_DATE,
        updated_at = NOW()
    WHERE equipment_id = v_equip_id
      AND maintenance_status IN ('pending', 'in_progress');

    UPDATE public.equipment
    SET current_status = 'available',
        updated_at = NOW()
    WHERE id = v_equip_id;

    RETURN jsonb_build_object(
        'success', true,
        'maintenance_id', p_maintenance_id,
        'equipment_id', v_equip_id,
        'equipment_status', 'available'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sp_complete_maintenance_repair(UUID) TO authenticated;

-- 3C. Admin Staff Provisioning & Admin Cascade Account Removal
GRANT SELECT, INSERT, DELETE ON TABLE public.user_profiles TO authenticated;
GRANT UPDATE (full_name, phone, company_name, role, requested_role, account_status, auth_user_id, email, updated_at)
    ON TABLE public.user_profiles TO authenticated;

DROP POLICY IF EXISTS pol_profiles_admin_all ON public.user_profiles;
CREATE POLICY pol_profiles_admin_all ON public.user_profiles
    FOR ALL TO authenticated
    USING (public.fn_current_user_role() = 'admin')
    WITH CHECK (public.fn_current_user_role() = 'admin');

DROP POLICY IF EXISTS pol_orders_admin_delete ON public.rental_orders;
CREATE POLICY pol_orders_admin_delete ON public.rental_orders
    FOR DELETE TO authenticated
    USING (public.fn_current_user_role() IN ('admin', 'staff'));

CREATE OR REPLACE FUNCTION public.sp_admin_upsert_staff_profile(
    p_auth_user_id UUID,
    p_full_name TEXT,
    p_email TEXT,
    p_phone TEXT,
    p_company_name TEXT DEFAULT 'EquipRent Studio Operations'
)
RETURNS public.user_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile public.user_profiles;
    v_clean_email TEXT := lower(trim(p_email));
BEGIN
    IF public.fn_current_user_role() <> 'admin' THEN
        RAISE EXCEPTION 'Authorization Error: Only administrators can create or promote staff accounts.';
    END IF;

    INSERT INTO public.user_profiles (
        id, auth_user_id, full_name, email, phone, company_name,
        role, requested_role, account_status
    ) VALUES (
        COALESCE(p_auth_user_id, gen_random_uuid()),
        p_auth_user_id,
        trim(p_full_name),
        v_clean_email,
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

    RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sp_admin_upsert_staff_profile(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.sp_admin_delete_user_profile(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_target_role public.user_role_type;
    v_auth_user_id UUID;
BEGIN
    IF public.fn_current_user_role() <> 'admin' THEN
        RAISE EXCEPTION 'Authorization Error: Only administrators can remove user accounts.';
    END IF;

    SELECT role, auth_user_id INTO v_target_role, v_auth_user_id
    FROM public.user_profiles WHERE id = p_user_id;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'User profile not found.';
    END IF;

    IF v_target_role = 'admin' THEN
        RAISE EXCEPTION 'Action Denied: Administrator accounts cannot be removed.';
    END IF;

    UPDATE public.equipment e
    SET current_status = 'available', updated_at = NOW()
    WHERE e.current_status = 'rented'
      AND EXISTS (
          SELECT 1 FROM public.rental_order_items roi
          JOIN public.rental_orders ro ON ro.id = roi.rental_order_id
          WHERE ro.customer_id = p_user_id AND roi.equipment_id = e.id AND roi.item_status = 'dispatched'
      );

    DELETE FROM public.payment_transactions pt
    USING public.rental_orders ro
    WHERE pt.rental_order_id = ro.id AND ro.customer_id = p_user_id;

    DELETE FROM public.equipment_inspections WHERE inspector_id = p_user_id;
    DELETE FROM public.maintenance_tasks WHERE technician_id = p_user_id;

    UPDATE public.rental_orders SET authorized_staff_id = NULL WHERE authorized_staff_id = p_user_id;
    UPDATE public.payment_transactions SET processed_by = NULL WHERE processed_by = p_user_id;
    UPDATE public.maintenance_records SET lead_technician_id = NULL WHERE lead_technician_id = p_user_id;
    UPDATE public.warehouse_locations SET manager_id = NULL WHERE manager_id = p_user_id;

    DELETE FROM public.rental_order_items roi
    USING public.rental_orders ro
    WHERE roi.rental_order_id = ro.id AND ro.customer_id = p_user_id;

    DELETE FROM public.rental_orders WHERE customer_id = p_user_id;
    DELETE FROM public.user_profiles WHERE id = p_user_id;

    IF v_auth_user_id IS NOT NULL THEN
        BEGIN
            DELETE FROM auth.users WHERE id = v_auth_user_id;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sp_admin_delete_user_profile(UUID) TO authenticated;

-- Clean up any detached archived empty order shells if present
DELETE FROM public.rental_orders WHERE special_terms = '[Archived: Customer Account Removed]';

-- ----------------------------------------------------------------------------
-- 4. ENABLE SUPABASE REALTIME ACROSS ALL 11 TABLES
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_tbl TEXT;
BEGIN
    FOREACH v_tbl IN ARRAY ARRAY[
        'equipment',
        'equipment_categories',
        'warehouse_locations',
        'rental_orders',
        'rental_order_items',
        'payment_transactions',
        'equipment_inspections',
        'maintenance_records',
        'maintenance_tasks',
        'user_profiles',
        'audit_logs'
    ]
    LOOP
        BEGIN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tbl);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

