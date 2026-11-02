-- Migration 08: Customer Order Cancellation & Admin Management Policies

-- 1. Allow customers to cancel their own pending (draft) rental reservations
DROP POLICY IF EXISTS pol_orders_customer_cancel ON public.rental_orders;
CREATE POLICY pol_orders_customer_cancel ON public.rental_orders
    FOR UPDATE TO authenticated
    USING (
        (customer_id = auth.uid() OR customer_id IN (
            SELECT id FROM public.user_profiles WHERE auth_user_id = auth.uid()
        ))
        AND status = 'draft'
    )
    WITH CHECK (
        status = 'cancelled'
    );

-- 2. Allow Admins full management on user profiles (removing staff/customer, adding staff)
DROP POLICY IF EXISTS pol_profiles_admin_all ON public.user_profiles;
CREATE POLICY pol_profiles_admin_all ON public.user_profiles
    FOR ALL TO authenticated
    USING (public.fn_current_user_role() = 'admin')
    WITH CHECK (public.fn_current_user_role() = 'admin');

-- 3. Allow Admins full CRUD on equipment
DROP POLICY IF EXISTS pol_equipment_admin_crud ON public.equipment;
CREATE POLICY pol_equipment_admin_crud ON public.equipment
    FOR ALL TO authenticated
    USING (public.fn_current_user_role() = 'admin')
    WITH CHECK (public.fn_current_user_role() = 'admin');

