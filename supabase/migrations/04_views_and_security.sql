-- ============================================================================
-- EQUIPRENT DATABASE ENGINEERING SPECIFICATION
-- MIGRATION 04: REPORTING VIEWS, ROW LEVEL SECURITY (RLS) & RBAC
-- Target: PostgreSQL 15+ / Supabase Cloud Database Cluster
-- Compliance: 3 Distinct User Tiers (Admin, Staff, Customer),
--             No Root Database Connection, Server-Side Abstracted Views
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SECURE DATABASE VIEWS (Abstracting Metrics & Sensitive Columns)
-- ----------------------------------------------------------------------------

-- View 1: Public/Customer Equipment Catalog (Hides replacement values & internal wear)
CREATE OR REPLACE VIEW vw_equipment_catalog AS
SELECT
    e.id AS equipment_id,
    e.model_name,
    e.serial_number,
    e.manufacturer,
    e.model_year,
    ec.category_name,
    ec.category_code,
    ec.base_daily_insurance_rate,
    e.daily_rental_rate,
    e.current_status,
    e.image_url,
    wl.branch_name AS warehouse_name,
    wl.city AS warehouse_city
FROM equipment e
JOIN equipment_categories ec ON ec.id = e.category_id
JOIN warehouse_locations wl ON wl.id = e.warehouse_id
WHERE e.current_status <> 'decommissioned';

-- View 2: Active Rentals Workflow & Fleet Monitor (Staff / Admin View)
CREATE OR REPLACE VIEW vw_active_rentals_dashboard AS
SELECT
    ro.id AS order_id,
    ro.order_number,
    ro.status AS order_status,
    ro.expected_start_date,
    ro.expected_end_date,
    ro.total_amount,
    ro.payment_status,
    c.full_name AS customer_name,
    c.company_name AS customer_company,
    c.email AS customer_email,
    c.phone AS customer_phone,
    s.full_name AS authorized_by_staff,
    COUNT(roi.id) AS total_items_count,
    COUNT(roi.id) FILTER (WHERE roi.item_status = 'dispatched') AS dispatched_items_count,
    COUNT(roi.id) FILTER (WHERE roi.item_status = 'returned') AS returned_items_count
FROM rental_orders ro
JOIN user_profiles c ON c.id = ro.customer_id
LEFT JOIN user_profiles s ON s.id = ro.authorized_staff_id
LEFT JOIN rental_order_items roi ON roi.rental_order_id = ro.id
GROUP BY ro.id, c.id, s.id;

-- View 3: Maintenance & Inspection Oversight
CREATE OR REPLACE VIEW vw_maintenance_schedule_overview AS
SELECT
    mr.id AS maintenance_id,
    mr.work_order_number,
    mr.maintenance_type,
    mr.maintenance_status,
    mr.scheduled_date,
    mr.completed_date,
    mr.total_maintenance_cost,
    mr.odometer_hours_at_service,
    e.model_name,
    e.serial_number,
    tech.full_name AS technician_name,
    COUNT(mt.id) AS subtask_count,
    COALESCE(SUM(mt.hours_logged), 0) AS total_labor_hours
FROM maintenance_records mr
JOIN equipment e ON e.id = mr.equipment_id
LEFT JOIN user_profiles tech ON tech.id = mr.lead_technician_id
LEFT JOIN maintenance_tasks mt ON mt.maintenance_id = mr.id
GROUP BY mr.id, e.id, tech.id;

-- ----------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY (RLS) POLICIES FOR 3 DISTINCT TIERS
-- Tier 1: 'admin' - full access across all tables
-- Tier 2: 'staff' - operational access to manage orders, equipment, maintenance
-- Tier 3: 'customer' - strictly isolated to their own records and public catalog
-- ----------------------------------------------------------------------------

-- Helper functions to extract profile ID and user role from profile matching auth.uid()
CREATE OR REPLACE FUNCTION fn_current_profile_id()
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

CREATE OR REPLACE FUNCTION fn_current_user_role()
RETURNS user_role_type
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role user_role_type;
BEGIN
    SELECT role INTO v_role
    FROM public.user_profiles
    WHERE auth_user_id = auth.uid()
       OR id = auth.uid()
    LIMIT 1;
    RETURN COALESCE(v_role, 'customer'::user_role_type);
END;
$$;

-- Enable RLS across all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Equipment & Categories: Anyone authenticated or anonymous can view equipment/categories
CREATE POLICY pol_categories_read ON equipment_categories FOR SELECT USING (true);
CREATE POLICY pol_equipment_read ON equipment FOR SELECT USING (true);
CREATE POLICY pol_warehouses_read ON warehouse_locations FOR SELECT USING (true);

-- Equipment modifications restricted to Staff & Admin
CREATE POLICY pol_equipment_staff_modify ON equipment
FOR ALL TO authenticated
USING (fn_current_user_role() IN ('admin', 'staff'))
WITH CHECK (fn_current_user_role() IN ('admin', 'staff'));

-- Rental Orders RLS: Customers are strictly isolated to their own orders
CREATE POLICY pol_orders_customer_select ON rental_orders
FOR SELECT TO authenticated
USING (
    customer_id = fn_current_profile_id()
    OR fn_current_user_role() IN ('admin', 'staff')
);

CREATE POLICY pol_orders_customer_insert ON rental_orders
FOR INSERT TO authenticated
WITH CHECK (
    (customer_id = fn_current_profile_id() AND status = 'draft')
    OR fn_current_user_role() IN ('admin', 'staff')
);

CREATE POLICY pol_orders_customer_cancel ON rental_orders
FOR UPDATE TO authenticated
USING (
    customer_id = fn_current_profile_id()
    AND status = 'draft'
)
WITH CHECK (
    customer_id = fn_current_profile_id()
    AND status = 'cancelled'
);

CREATE POLICY pol_orders_customer_delete_draft ON rental_orders
FOR DELETE TO authenticated
USING (
    customer_id = fn_current_profile_id()
    AND status = 'draft'
);

CREATE POLICY pol_orders_staff_update ON rental_orders
FOR UPDATE TO authenticated
USING (fn_current_user_role() IN ('admin', 'staff'))
WITH CHECK (fn_current_user_role() IN ('admin', 'staff'));

-- Rental Order Items RLS: Customers can select and insert items ONLY for their own draft orders
CREATE POLICY pol_order_items_select ON rental_order_items
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM rental_orders ro
        WHERE ro.id = rental_order_items.rental_order_id
          AND (ro.customer_id = fn_current_profile_id() OR fn_current_user_role() IN ('admin', 'staff'))
    )
);

CREATE POLICY pol_order_items_customer_insert ON rental_order_items
FOR INSERT TO authenticated
WITH CHECK (
    item_status = 'reserved'
    AND EXISTS (
        SELECT 1 FROM rental_orders ro
        WHERE ro.id = rental_order_items.rental_order_id
          AND ro.customer_id = fn_current_profile_id()
          AND ro.status = 'draft'
    )
);

CREATE POLICY pol_order_items_staff_all ON rental_order_items
FOR ALL TO authenticated
USING (fn_current_user_role() IN ('admin', 'staff'))
WITH CHECK (fn_current_user_role() IN ('admin', 'staff'));

-- Maintenance & Inspections: Accessible exclusively to Staff and Admin
CREATE POLICY pol_maintenance_staff ON maintenance_records
FOR ALL TO authenticated
USING (fn_current_user_role() IN ('admin', 'staff'))
WITH CHECK (fn_current_user_role() IN ('admin', 'staff'));

CREATE POLICY pol_tasks_staff ON maintenance_tasks
FOR ALL TO authenticated
USING (fn_current_user_role() IN ('admin', 'staff'))
WITH CHECK (fn_current_user_role() IN ('admin', 'staff'));

CREATE POLICY pol_inspections_staff ON equipment_inspections
FOR ALL TO authenticated
USING (fn_current_user_role() IN ('admin', 'staff'))
WITH CHECK (fn_current_user_role() IN ('admin', 'staff'));

-- Audit Logs RLS: Strictly read-only for Admins, no client can mutate
CREATE POLICY pol_audit_admin_only ON audit_logs
FOR SELECT TO authenticated
USING (fn_current_user_role() = 'admin');

-- Public catalog read only (no anonymous access to orders, profiles, or logs)
CREATE POLICY pol_anon_equipment_select ON equipment FOR SELECT TO anon USING (true);
CREATE POLICY pol_anon_categories_select ON equipment_categories FOR SELECT TO anon USING (true);
CREATE POLICY pol_anon_warehouses_select ON warehouse_locations FOR SELECT TO anon USING (true);
