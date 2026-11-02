-- ============================================================================
-- EQUIPRENT MIGRATION 12:
-- Fix Admin "Remove Customer" / "Remove Staff":
-- Allows Admin to cleanly remove customer or staff accounts even when they have
-- linked rental orders, payment records, maintenance tasks, or inspections.
-- Safe to run on your existing Supabase project.
-- ============================================================================

-- 1. Allow Admin to delete rental_orders rows when cleaning up accounts/orders
DROP POLICY IF EXISTS pol_orders_admin_delete ON public.rental_orders;
CREATE POLICY pol_orders_admin_delete ON public.rental_orders
    FOR DELETE TO authenticated
    USING (public.fn_current_user_role() = 'admin');

-- 2. Upgrade sp_admin_delete_user_profile to safely clean up linked records
--    and remove both the user_profiles row and linked auth.users account.
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

    SELECT role, auth_user_id
    INTO v_target_role, v_auth_user_id
    FROM public.user_profiles
    WHERE id = p_user_id;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'User profile not found.';
    END IF;

    IF v_target_role = 'admin' THEN
        RAISE EXCEPTION 'Action Denied: Administrator accounts cannot be removed.';
    END IF;

    -- A. If the customer currently had any equipment marked 'dispatched' ('rented'),
    --    restore those units back to 'available' (unless under active maintenance)
    UPDATE public.equipment e
    SET current_status = 'available',
        updated_at = NOW()
    WHERE e.current_status = 'rented'
      AND EXISTS (
          SELECT 1
          FROM public.rental_order_items roi
          JOIN public.rental_orders ro ON ro.id = roi.rental_order_id
          WHERE ro.customer_id = p_user_id
            AND roi.equipment_id = e.id
            AND roi.item_status = 'dispatched'
      )
      AND NOT EXISTS (
          SELECT 1
          FROM public.maintenance_records mr
          WHERE mr.equipment_id = e.id
            AND mr.maintenance_status IN ('pending', 'in_progress')
      );

    -- B. Delete payment transactions tied to this customer's orders
    DELETE FROM public.payment_transactions pt
    USING public.rental_orders ro
    WHERE pt.rental_order_id = ro.id
      AND ro.customer_id = p_user_id;

    -- C. Delete inspections & maintenance tasks tied to this user (e.g. if removing Staff)
    DELETE FROM public.equipment_inspections
    WHERE inspector_id = p_user_id;

    DELETE FROM public.maintenance_tasks
    WHERE technician_id = p_user_id;

    -- D. Clear nullable staff/manager references
    UPDATE public.rental_orders
    SET authorized_staff_id = NULL
    WHERE authorized_staff_id = p_user_id;

    UPDATE public.payment_transactions
    SET processed_by = NULL
    WHERE processed_by = p_user_id;

    UPDATE public.maintenance_records
    SET lead_technician_id = NULL
    WHERE lead_technician_id = p_user_id;

    UPDATE public.warehouse_locations
    SET manager_id = NULL
    WHERE manager_id = p_user_id;

    -- E. Delete customer's rental order items & rental orders (cascades inspections)
    DELETE FROM public.rental_order_items roi
    USING public.rental_orders ro
    WHERE roi.rental_order_id = ro.id
      AND ro.customer_id = p_user_id;

    DELETE FROM public.rental_orders
    WHERE customer_id = p_user_id;

    -- F. Delete the user profile
    DELETE FROM public.user_profiles
    WHERE id = p_user_id;

    -- G. Also delete the Supabase Auth login if accessible so their email is freed up
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

-- Clean up any detached empty order shells or previously archived deleted accounts
DELETE FROM public.rental_orders
WHERE special_terms = '[Archived: Customer Account Removed]';

DO $$
DECLARE
    v_rec RECORD;
BEGIN
    FOR v_rec IN
        SELECT id, auth_user_id
        FROM public.user_profiles
        WHERE account_status = 'suspended'
          AND email LIKE 'removed-%@deleted.equiprent.local'
          AND role <> 'admin'
    LOOP
        DELETE FROM public.payment_transactions pt
        USING public.rental_orders ro
        WHERE pt.rental_order_id = ro.id AND ro.customer_id = v_rec.id;

        DELETE FROM public.equipment_inspections WHERE inspector_id = v_rec.id;
        DELETE FROM public.maintenance_tasks WHERE technician_id = v_rec.id;
        UPDATE public.rental_orders SET authorized_staff_id = NULL WHERE authorized_staff_id = v_rec.id;
        UPDATE public.payment_transactions SET processed_by = NULL WHERE processed_by = v_rec.id;
        UPDATE public.maintenance_records SET lead_technician_id = NULL WHERE lead_technician_id = v_rec.id;
        UPDATE public.warehouse_locations SET manager_id = NULL WHERE manager_id = v_rec.id;

        DELETE FROM public.rental_order_items roi
        USING public.rental_orders ro
        WHERE roi.rental_order_id = ro.id AND ro.customer_id = v_rec.id;

        DELETE FROM public.rental_orders WHERE customer_id = v_rec.id;
        DELETE FROM public.user_profiles WHERE id = v_rec.id;

        IF v_rec.auth_user_id IS NOT NULL THEN
            BEGIN
                DELETE FROM auth.users WHERE id = v_rec.auth_user_id;
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END;
        END IF;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

