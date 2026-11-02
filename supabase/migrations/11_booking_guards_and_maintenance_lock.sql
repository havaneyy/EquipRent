-- ============================================================================
-- EQUIPRENT MIGRATION 11:
-- 1. Enforce past-date booking rejection on rental_orders INSERT
-- 2. Allow Staff/Admin booking & draft/rollback cleanup on rental_orders
-- 3. Lock under_maintenance equipment from bypassing Maintenance Queue:
--    an item with an active maintenance work order MUST be marked Repaired
--    (completed) in Maintenance Queue before becoming 'available'.
-- Safe to run on your existing Supabase project.
-- ============================================================================

-- 1. Prevent booking on previous/past dates at the database layer
CREATE OR REPLACE FUNCTION public.fn_prevent_past_rental_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_today_ph DATE := (NOW() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
    IF NEW.expected_start_date < v_today_ph THEN
        RAISE EXCEPTION 'Invalid Rental Date: Start date (%) cannot be in the past. Choose % or a future date.',
            NEW.expected_start_date, v_today_ph;
    END IF;

    IF NEW.expected_end_date < NEW.expected_start_date THEN
        RAISE EXCEPTION 'Invalid Rental Date: End date (%) cannot be earlier than start date (%).',
            NEW.expected_end_date, NEW.expected_start_date;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_past_rental_dates ON public.rental_orders;
CREATE TRIGGER trg_prevent_past_rental_dates
BEFORE INSERT ON public.rental_orders
FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_past_rental_dates();

-- 2. Ensure Staff/Admin can clean up failed order inserts when booking on behalf of a Customer
DROP POLICY IF EXISTS pol_orders_customer_delete_draft ON public.rental_orders;
CREATE POLICY pol_orders_customer_delete_draft ON public.rental_orders
    FOR DELETE TO authenticated
    USING (
        (customer_id = public.fn_current_profile_id() AND status = 'draft')
        OR (public.fn_current_user_role() IN ('admin', 'staff') AND status IN ('draft', 'confirmed'))
    );

-- 3. Prevent under_maintenance equipment from being toggled straight to 'available'
--    while an active maintenance work order is still pending / in_progress
CREATE OR REPLACE FUNCTION public.fn_guard_equipment_maintenance_release()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.current_status = 'under_maintenance' AND NEW.current_status = 'available' THEN
        IF EXISTS (
            SELECT 1
            FROM public.maintenance_records mr
            WHERE mr.equipment_id = NEW.id
              AND mr.maintenance_status IN ('pending', 'in_progress')
        ) THEN
            RAISE EXCEPTION 'Maintenance Lock: Equipment has an active repair in Maintenance Queue. Mark it as Repaired in Maintenance Queue first.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_equipment_maintenance_release ON public.equipment;
CREATE TRIGGER trg_guard_equipment_maintenance_release
BEFORE UPDATE OF current_status ON public.equipment
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_equipment_maintenance_release();

NOTIFY pgrst, 'reload schema';

