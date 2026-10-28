-- ============================================================================
-- EQUIPRENT DATABASE ENGINEERING SPECIFICATION
-- ALL-IN-ONE MASTER DEPLOYMENT SCRIPT (FOR SUPABASE SQL EDITOR)
-- Builds the schema, triggers, stored procedures, views, and RLS policies.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1: EXTENSIONS & CLEANUP
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DROP TABLE IF EXISTS equipment_inspections CASCADE;
DROP TABLE IF EXISTS maintenance_tasks CASCADE;
DROP TABLE IF EXISTS maintenance_records CASCADE;
DROP TABLE IF EXISTS payment_transactions CASCADE;
DROP TABLE IF EXISTS rental_order_items CASCADE;
DROP TABLE IF EXISTS rental_orders CASCADE;
DROP TABLE IF EXISTS equipment CASCADE;
DROP TABLE IF EXISTS equipment_categories CASCADE;
DROP TABLE IF EXISTS warehouse_locations CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;

DROP TYPE IF EXISTS user_role_type CASCADE;
DROP TYPE IF EXISTS equipment_status_type CASCADE;
DROP TYPE IF EXISTS rental_order_status CASCADE;
DROP TYPE IF EXISTS item_rental_status CASCADE;
DROP TYPE IF EXISTS payment_status_type CASCADE;
DROP TYPE IF EXISTS payment_method_type CASCADE;
DROP TYPE IF EXISTS maintenance_type_enum CASCADE;
DROP TYPE IF EXISTS maintenance_status_enum CASCADE;
DROP TYPE IF EXISTS inspection_type_enum CASCADE;

-- ----------------------------------------------------------------------------
-- STEP 2: ENUM TYPES & TABLES
-- ----------------------------------------------------------------------------
CREATE TYPE user_role_type AS ENUM ('admin', 'staff', 'customer');
CREATE TYPE equipment_status_type AS ENUM ('available', 'rented', 'under_maintenance', 'decommissioned');
CREATE TYPE rental_order_status AS ENUM ('draft', 'confirmed', 'in_progress', 'completed', 'cancelled');
CREATE TYPE item_rental_status AS ENUM ('reserved', 'dispatched', 'returned', 'damaged');
CREATE TYPE payment_status_type AS ENUM ('unpaid', 'partially_paid', 'paid', 'refunded');
CREATE TYPE payment_method_type AS ENUM ('credit_card', 'bank_transfer', 'corporate_credit', 'cash');
CREATE TYPE maintenance_type_enum AS ENUM ('scheduled_routine', 'emergency_repair', 'post_rental_inspection', 'major_overhaul');
CREATE TYPE maintenance_status_enum AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');
CREATE TYPE inspection_type_enum AS ENUM ('pre_dispatch', 'post_return');

CREATE TABLE user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(30) NOT NULL,
    company_name VARCHAR(150),
    role user_role_type NOT NULL DEFAULT 'customer',
    requested_role user_role_type,
    account_status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE warehouse_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_code VARCHAR(15) NOT NULL UNIQUE,
    branch_name VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(80) NOT NULL,
    region VARCHAR(80) NOT NULL,
    contact_phone VARCHAR(30) NOT NULL,
    manager_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    max_storage_capacity INT NOT NULL CHECK (max_storage_capacity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE equipment_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_name VARCHAR(80) NOT NULL UNIQUE,
    category_code VARCHAR(20) NOT NULL UNIQUE,
    description TEXT,
    base_daily_insurance_rate NUMERIC(10, 2) NOT NULL CHECK (base_daily_insurance_rate >= 0),
    requires_operator_certification BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE equipment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_number VARCHAR(60) NOT NULL UNIQUE,
    model_name VARCHAR(120) NOT NULL,
    manufacturer VARCHAR(80) NOT NULL,
    model_year INT NOT NULL CHECK (model_year >= 1990 AND model_year <= 2030),
    category_id UUID NOT NULL REFERENCES equipment_categories(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouse_locations(id) ON DELETE RESTRICT,
    daily_rental_rate NUMERIC(10, 2) NOT NULL CHECK (daily_rental_rate > 0),
    replacement_value NUMERIC(12, 2) NOT NULL CHECK (replacement_value > 0),
    operational_hours NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (operational_hours >= 0),
    current_status equipment_status_type NOT NULL DEFAULT 'available',
    image_url TEXT,
    maintenance_interval_hours NUMERIC(10, 2) NOT NULL DEFAULT 250.00 CHECK (maintenance_interval_hours > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rental_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(30) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
    authorized_staff_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    status rental_order_status NOT NULL DEFAULT 'draft',
    order_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expected_start_date DATE NOT NULL,
    expected_end_date DATE NOT NULL,
    actual_return_date DATE,
    subtotal_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (subtotal_amount >= 0),
    insurance_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (insurance_amount >= 0),
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    security_deposit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (security_deposit_amount >= 0),
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
    payment_status payment_status_type NOT NULL DEFAULT 'unpaid',
    delivery_address TEXT,
    special_terms TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_order_date_range CHECK (expected_end_date >= expected_start_date)
);

CREATE TABLE rental_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rental_order_id UUID NOT NULL REFERENCES rental_orders(id) ON DELETE CASCADE,
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
    unit_daily_rate NUMERIC(10, 2) NOT NULL CHECK (unit_daily_rate > 0),
    days_rented INT NOT NULL CHECK (days_rented > 0),
    daily_insurance_rate NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (daily_insurance_rate >= 0),
    item_subtotal NUMERIC(12, 2) NOT NULL CHECK (item_subtotal >= 0),
    item_status item_rental_status NOT NULL DEFAULT 'reserved',
    dispatch_odometer_hours NUMERIC(10, 2),
    return_odometer_hours NUMERIC(10, 2),
    dispatched_at TIMESTAMPTZ,
    returned_at TIMESTAMPTZ,
    condition_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_order_equipment UNIQUE (rental_order_id, equipment_id),
    CONSTRAINT chk_return_odometer CHECK (
        return_odometer_hours IS NULL OR dispatch_odometer_hours IS NULL OR return_odometer_hours >= dispatch_odometer_hours
    )
);

CREATE TABLE payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rental_order_id UUID NOT NULL REFERENCES rental_orders(id) ON DELETE RESTRICT,
    transaction_reference VARCHAR(64) NOT NULL UNIQUE,
    payment_method payment_method_type NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    transaction_status VARCHAR(20) NOT NULL DEFAULT 'succeeded' CHECK (transaction_status IN ('pending', 'succeeded', 'failed', 'refunded')),
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    gateway_response JSONB
);

CREATE TABLE maintenance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_number VARCHAR(30) NOT NULL UNIQUE,
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
    maintenance_type maintenance_type_enum NOT NULL,
    maintenance_status maintenance_status_enum NOT NULL DEFAULT 'pending',
    scheduled_date DATE NOT NULL,
    completed_date DATE,
    odometer_hours_at_service NUMERIC(10, 2) NOT NULL CHECK (odometer_hours_at_service >= 0),
    parts_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (parts_cost >= 0),
    labor_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (labor_cost >= 0),
    total_maintenance_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (total_maintenance_cost >= 0),
    lead_technician_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    service_description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE maintenance_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maintenance_id UUID NOT NULL REFERENCES maintenance_records(id) ON DELETE CASCADE,
    technician_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
    task_code VARCHAR(30) NOT NULL,
    task_name VARCHAR(120) NOT NULL,
    hours_logged NUMERIC(6, 2) NOT NULL DEFAULT 0.00 CHECK (hours_logged >= 0),
    hourly_labor_rate NUMERIC(8, 2) NOT NULL CHECK (hourly_labor_rate > 0),
    task_cost NUMERIC(10, 2) GENERATED ALWAYS AS (hours_logged * hourly_labor_rate) STORED,
    progress_status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (progress_status IN ('assigned', 'in_progress', 'completed', 'blocked')),
    findings_report TEXT,
    sign_off_timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE equipment_inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rental_order_item_id UUID NOT NULL REFERENCES rental_order_items(id) ON DELETE CASCADE,
    inspector_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
    inspection_type inspection_type_enum NOT NULL,
    fuel_level_percent INT NOT NULL CHECK (fuel_level_percent >= 0 AND fuel_level_percent <= 100),
    odometer_reading NUMERIC(10, 2) NOT NULL CHECK (odometer_reading >= 0),
    cleanliness_rating INT NOT NULL CHECK (cleanliness_rating >= 1 AND cleanliness_rating <= 5),
    structural_integrity_rating INT NOT NULL CHECK (structural_integrity_rating >= 1 AND structural_integrity_rating <= 5),
    damage_identified BOOLEAN NOT NULL DEFAULT FALSE,
    damage_assessment_notes TEXT,
    penalty_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (penalty_fee >= 0),
    sign_off_status BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(80) NOT NULL,
    record_id VARCHAR(64) NOT NULL,
    action_type VARCHAR(10) NOT NULL CHECK (action_type IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data JSONB,
    new_data JSONB,
    changed_fields TEXT[],
    performed_by UUID,
    client_ip INET,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_equipment_category_status ON equipment(category_id, current_status);
CREATE INDEX idx_equipment_warehouse ON equipment(warehouse_id);
CREATE INDEX idx_rental_orders_customer_status ON rental_orders(customer_id, status);
CREATE INDEX idx_rental_order_items_composite ON rental_order_items(rental_order_id, equipment_id, item_status);
CREATE INDEX idx_maintenance_records_equip_status ON maintenance_records(equipment_id, maintenance_status);
CREATE INDEX idx_maintenance_tasks_tech ON maintenance_tasks(technician_id, progress_status);
CREATE INDEX idx_inspections_order_item ON equipment_inspections(rental_order_item_id);
CREATE INDEX idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_logs_executed_at ON audit_logs(executed_at DESC);

-- ----------------------------------------------------------------------------
-- STEP 3: TRIGGERS & AUTOMATION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_equipment_updated_at BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_rental_orders_updated_at BEFORE UPDATE ON rental_orders FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_maintenance_records_updated_at BEFORE UPDATE ON maintenance_records FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE OR REPLACE FUNCTION fn_universal_audit_logger()
RETURNS TRIGGER AS $$
DECLARE
    v_record_id VARCHAR(64);
    v_old_json JSONB := NULL;
    v_new_json JSONB := NULL;
    v_user_id UUID := NULL;
BEGIN
    BEGIN
        v_user_id := NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
    END;

    IF (TG_OP = 'DELETE') THEN
        v_record_id := OLD.id::TEXT;
        v_old_json := to_jsonb(OLD);
        INSERT INTO audit_logs (table_name, record_id, action_type, old_data, new_data, performed_by)
        VALUES (TG_TABLE_NAME, v_record_id, 'DELETE', v_old_json, NULL, v_user_id);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        v_record_id := NEW.id::TEXT;
        v_old_json := to_jsonb(OLD);
        v_new_json := to_jsonb(NEW);
        
        IF (v_old_json - 'updated_at') IS DISTINCT FROM (v_new_json - 'updated_at') THEN
            INSERT INTO audit_logs (table_name, record_id, action_type, old_data, new_data, performed_by)
            VALUES (TG_TABLE_NAME, v_record_id, 'UPDATE', v_old_json, v_new_json, v_user_id);
        END IF;
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        v_record_id := NEW.id::TEXT;
        v_new_json := to_jsonb(NEW);
        INSERT INTO audit_logs (table_name, record_id, action_type, old_data, new_data, performed_by)
        VALUES (TG_TABLE_NAME, v_record_id, 'INSERT', NULL, v_new_json, v_user_id);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_audit_equipment AFTER INSERT OR UPDATE OR DELETE ON equipment FOR EACH ROW EXECUTE FUNCTION fn_universal_audit_logger();
CREATE TRIGGER trg_audit_rental_orders AFTER INSERT OR UPDATE OR DELETE ON rental_orders FOR EACH ROW EXECUTE FUNCTION fn_universal_audit_logger();
CREATE TRIGGER trg_audit_rental_order_items AFTER INSERT OR UPDATE OR DELETE ON rental_order_items FOR EACH ROW EXECUTE FUNCTION fn_universal_audit_logger();
CREATE TRIGGER trg_audit_maintenance_records AFTER INSERT OR UPDATE OR DELETE ON maintenance_records FOR EACH ROW EXECUTE FUNCTION fn_universal_audit_logger();
CREATE TRIGGER trg_audit_payment_transactions AFTER INSERT OR UPDATE OR DELETE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION fn_universal_audit_logger();

CREATE OR REPLACE FUNCTION fn_sync_equipment_rental_status()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        IF NEW.item_status = 'dispatched' THEN
            UPDATE equipment SET current_status = 'rented' WHERE id = NEW.equipment_id;
        ELSIF NEW.item_status = 'returned' THEN
            IF NEW.condition_notes ILIKE '%damage%' OR NEW.condition_notes ILIKE '%repair%' THEN
                UPDATE equipment SET current_status = 'under_maintenance', operational_hours = COALESCE(NEW.return_odometer_hours, operational_hours) WHERE id = NEW.equipment_id;
            ELSE
                UPDATE equipment SET current_status = 'available', operational_hours = COALESCE(NEW.return_odometer_hours, operational_hours) WHERE id = NEW.equipment_id;
            END IF;
        ELSIF NEW.item_status = 'damaged' THEN
            UPDATE equipment SET current_status = 'under_maintenance', operational_hours = COALESCE(NEW.return_odometer_hours, operational_hours) WHERE id = NEW.equipment_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_equipment_status AFTER INSERT OR UPDATE OF item_status, return_odometer_hours ON rental_order_items FOR EACH ROW EXECUTE FUNCTION fn_sync_equipment_rental_status();

CREATE OR REPLACE FUNCTION fn_recalculate_order_financials()
RETURNS TRIGGER AS $$
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

    SELECT COALESCE(SUM(item_subtotal), 0.00) INTO v_new_subtotal
    FROM rental_order_items
    WHERE rental_order_id = v_order_id;

    SELECT COALESCE(SUM(daily_insurance_rate * days_rented), 0.00) INTO v_new_insurance
    FROM rental_order_items
    WHERE rental_order_id = v_order_id;

    v_new_tax := ROUND((v_new_subtotal + v_new_insurance) * v_tax_rate, 2);

    UPDATE rental_orders
    SET subtotal_amount = v_new_subtotal,
        insurance_amount = v_new_insurance,
        tax_amount = v_new_tax,
        total_amount = v_new_subtotal + v_new_insurance + v_new_tax + security_deposit_amount,
        updated_at = NOW()
    WHERE id = v_order_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalc_order_financials AFTER INSERT OR UPDATE OF item_subtotal, unit_daily_rate, daily_insurance_rate, days_rented OR DELETE ON rental_order_items FOR EACH ROW EXECUTE FUNCTION fn_recalculate_order_financials();

CREATE OR REPLACE FUNCTION fn_guard_prevent_double_booking()
RETURNS TRIGGER AS $$
DECLARE
    v_order_start DATE;
    v_order_end DATE;
    v_collision_count INT;
    v_equip_status equipment_status_type;
BEGIN
    SELECT current_status INTO v_equip_status FROM equipment WHERE id = NEW.equipment_id;
    IF v_equip_status = 'decommissioned' THEN
        RAISE EXCEPTION 'Database Integrity Error: Equipment % is decommissioned and cannot be rented.', NEW.equipment_id;
    END IF;

    SELECT expected_start_date, expected_end_date INTO v_order_start, v_order_end
    FROM rental_orders WHERE id = NEW.rental_order_id;

    SELECT COUNT(*) INTO v_collision_count
    FROM rental_order_items roi
    JOIN rental_orders ro ON ro.id = roi.rental_order_id
    WHERE roi.equipment_id = NEW.equipment_id
      AND roi.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
      AND roi.item_status IN ('reserved', 'dispatched')
      AND ro.status IN ('confirmed', 'in_progress')
      AND ((ro.expected_start_date <= v_order_end) AND (ro.expected_end_date >= v_order_start));

    IF v_collision_count > 0 THEN
        RAISE EXCEPTION 'Double-Booking Violation: Equipment unit % is already booked for overlapping date range.', NEW.equipment_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_double_booking BEFORE INSERT OR UPDATE OF equipment_id, rental_order_id, item_status ON rental_order_items FOR EACH ROW EXECUTE FUNCTION fn_guard_prevent_double_booking();

-- ----------------------------------------------------------------------------
-- STEP 4: STORED PROCEDURES & FUNCTIONS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sp_process_rental_checkout(
    p_order_id UUID,
    p_staff_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_order_status rental_order_status;
    v_staff_role user_role_type;
    v_item RECORD;
    v_unavailable_item_count INT;
    v_dispatched_items_count INT := 0;
    v_result JSONB;
BEGIN
    SELECT role INTO v_staff_role FROM user_profiles WHERE id = p_staff_id;
    IF v_staff_role IS NULL OR v_staff_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'Authorization Error: User % is not authorized to dispatch equipment.', p_staff_id;
    END IF;

    SELECT status INTO v_order_status FROM rental_orders WHERE id = p_order_id;
    IF v_order_status IS NULL THEN
        RAISE EXCEPTION 'Entity Not Found: Order % does not exist.', p_order_id;
    END IF;

    IF v_order_status NOT IN ('draft', 'confirmed') THEN
        RAISE EXCEPTION 'Invalid State Transition: Cannot checkout order with status "%".', v_order_status;
    END IF;

    SELECT COUNT(*) INTO v_unavailable_item_count
    FROM rental_order_items roi
    JOIN equipment e ON e.id = roi.equipment_id
    WHERE roi.rental_order_id = p_order_id
      AND e.current_status <> 'available';

    IF v_unavailable_item_count > 0 THEN
        RAISE EXCEPTION 'Equipment Allocation Conflict: % unit(s) are currently not available.', v_unavailable_item_count;
    END IF;

    FOR v_item IN
        SELECT roi.id AS item_id, roi.equipment_id, e.operational_hours
        FROM rental_order_items roi
        JOIN equipment e ON e.id = roi.equipment_id
        WHERE roi.rental_order_id = p_order_id
    LOOP
        UPDATE rental_order_items
        SET item_status = 'dispatched',
            dispatch_odometer_hours = v_item.operational_hours,
            dispatched_at = NOW()
        WHERE id = v_item.item_id;

        v_dispatched_items_count := v_dispatched_items_count + 1;
    END LOOP;

    UPDATE rental_orders
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION sp_process_equipment_return(
    p_order_item_id UUID,
    p_return_odometer NUMERIC,
    p_fuel_level INT,
    p_cleanliness INT,
    p_integrity INT,
    p_inspector_id UUID,
    p_damage_notes TEXT DEFAULT NULL,
    p_penalty_fee NUMERIC DEFAULT 0.00
)
RETURNS JSONB AS $$
DECLARE
    v_item RECORD;
    v_inspector_role user_role_type;
    v_has_damage BOOLEAN := FALSE;
    v_new_item_status item_rental_status;
    v_parent_order_id UUID;
    v_remaining_dispatched INT;
    v_maintenance_created BOOLEAN := FALSE;
    v_maintenance_id UUID := NULL;
    v_result JSONB;
BEGIN
    SELECT role INTO v_inspector_role FROM user_profiles WHERE id = p_inspector_id;
    IF v_inspector_role IS NULL OR v_inspector_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'Authorization Error: Inspector % is not authorized.', p_inspector_id;
    END IF;

    SELECT roi.*, e.maintenance_interval_hours, e.model_name
    INTO v_item
    FROM rental_order_items roi
    JOIN equipment e ON e.id = roi.equipment_id
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
    v_new_item_status := CASE WHEN v_has_damage THEN 'damaged'::item_rental_status ELSE 'returned'::item_rental_status END;

    INSERT INTO equipment_inspections (
        rental_order_item_id, inspector_id, inspection_type, fuel_level_percent,
        odometer_reading, cleanliness_rating, structural_integrity_rating,
        damage_identified, damage_assessment_notes, penalty_fee, sign_off_status
    ) VALUES (
        p_order_item_id, p_inspector_id, 'post_return', p_fuel_level,
        p_return_odometer, p_cleanliness, p_integrity,
        v_has_damage, p_damage_notes, COALESCE(p_penalty_fee, 0.00), TRUE
    );

    UPDATE rental_order_items
    SET item_status = v_new_item_status,
        return_odometer_hours = p_return_odometer,
        returned_at = NOW(),
        condition_notes = p_damage_notes
    WHERE id = p_order_item_id;

    IF v_has_damage OR (p_return_odometer >= v_item.maintenance_interval_hours) THEN
        INSERT INTO maintenance_records (
            work_order_number, equipment_id, maintenance_type, maintenance_status,
            scheduled_date, odometer_hours_at_service, lead_technician_id, service_description
        ) VALUES (
            'WO-' || to_char(NOW(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6),
            v_item.equipment_id,
            CASE WHEN v_has_damage THEN 'emergency_repair'::maintenance_type_enum ELSE 'scheduled_routine'::maintenance_type_enum END,
            'pending'::maintenance_status_enum,
            CURRENT_DATE, p_return_odometer, p_inspector_id,
            CASE WHEN v_has_damage
                THEN 'Post-return damage repair: ' || COALESCE(p_damage_notes, 'Physical inspection failure')
                ELSE 'Routine service milestone exceeded (' || p_return_odometer || ' hours logged)'
            END
        ) RETURNING id INTO v_maintenance_id;

        v_maintenance_created := TRUE;
    END IF;

    SELECT COUNT(*) INTO v_remaining_dispatched
    FROM rental_order_items
    WHERE rental_order_id = v_parent_order_id AND item_status = 'dispatched';

    IF v_remaining_dispatched = 0 THEN
        UPDATE rental_orders
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_get_fleet_utilization_analytics()
RETURNS TABLE (
    category_name VARCHAR(80),
    total_units BIGINT,
    available_units BIGINT,
    rented_units BIGINT,
    maintenance_units BIGINT,
    utilization_percentage NUMERIC(5, 2),
    total_revenue_generated NUMERIC(12, 2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ec.category_name,
        COUNT(e.id) AS total_units,
        COUNT(e.id) FILTER (WHERE e.current_status = 'available') AS available_units,
        COUNT(e.id) FILTER (WHERE e.current_status = 'rented') AS rented_units,
        COUNT(e.id) FILTER (WHERE e.current_status = 'under_maintenance') AS maintenance_units,
        ROUND(
            (COUNT(e.id) FILTER (WHERE e.current_status = 'rented')::NUMERIC / NULLIF(COUNT(e.id), 0)) * 100,
            2
        ) AS utilization_percentage,
        COALESCE(SUM(roi.item_subtotal), 0.00) AS total_revenue_generated
    FROM equipment_categories ec
    LEFT JOIN equipment e ON e.category_id = ec.id
    LEFT JOIN rental_order_items roi ON roi.equipment_id = e.id
    GROUP BY ec.category_name
    ORDER BY total_revenue_generated DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- STEP 5: VIEWS & ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION fn_current_user_role()
RETURNS user_role_type AS $$
DECLARE
    v_role user_role_type;
BEGIN
    SELECT role INTO v_role
    FROM user_profiles
    WHERE auth_user_id = auth.uid() OR id = auth.uid();
    RETURN COALESCE(v_role, 'customer'::user_role_type);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

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

CREATE POLICY pol_categories_read ON equipment_categories FOR SELECT USING (true);
CREATE POLICY pol_equipment_read ON equipment FOR SELECT USING (true);
CREATE POLICY pol_warehouses_read ON warehouse_locations FOR SELECT USING (true);
CREATE POLICY pol_equipment_staff_modify ON equipment FOR ALL TO authenticated USING (fn_current_user_role() IN ('admin', 'staff')) WITH CHECK (fn_current_user_role() IN ('admin', 'staff'));
CREATE POLICY pol_orders_customer_select ON rental_orders FOR SELECT TO authenticated USING (customer_id = auth.uid() OR auth.uid() IN (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid()) OR fn_current_user_role() IN ('admin', 'staff'));
CREATE POLICY pol_orders_customer_insert ON rental_orders FOR INSERT TO authenticated WITH CHECK (customer_id = auth.uid() OR auth.uid() IN (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid()) OR fn_current_user_role() IN ('admin', 'staff'));
CREATE POLICY pol_orders_staff_update ON rental_orders FOR UPDATE TO authenticated USING (fn_current_user_role() IN ('admin', 'staff')) WITH CHECK (fn_current_user_role() IN ('admin', 'staff'));
CREATE POLICY pol_order_items_select ON rental_order_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM rental_orders ro WHERE ro.id = rental_order_items.rental_order_id AND (ro.customer_id = auth.uid() OR fn_current_user_role() IN ('admin', 'staff'))));
CREATE POLICY pol_order_items_staff_all ON rental_order_items FOR ALL TO authenticated USING (fn_current_user_role() IN ('admin', 'staff')) WITH CHECK (fn_current_user_role() IN ('admin', 'staff'));
CREATE POLICY pol_maintenance_staff ON maintenance_records FOR ALL TO authenticated USING (fn_current_user_role() IN ('admin', 'staff')) WITH CHECK (fn_current_user_role() IN ('admin', 'staff'));
CREATE POLICY pol_tasks_staff ON maintenance_tasks FOR ALL TO authenticated USING (fn_current_user_role() IN ('admin', 'staff')) WITH CHECK (fn_current_user_role() IN ('admin', 'staff'));
CREATE POLICY pol_inspections_staff ON equipment_inspections FOR ALL TO authenticated USING (fn_current_user_role() IN ('admin', 'staff')) WITH CHECK (fn_current_user_role() IN ('admin', 'staff'));
CREATE POLICY pol_audit_admin_only ON audit_logs FOR SELECT TO authenticated USING (fn_current_user_role() = 'admin');

CREATE POLICY pol_anon_equipment_select ON equipment FOR SELECT TO anon USING (true);
CREATE POLICY pol_anon_categories_select ON equipment_categories FOR SELECT TO anon USING (true);
CREATE POLICY pol_anon_warehouses_select ON warehouse_locations FOR SELECT TO anon USING (true);
CREATE POLICY pol_anon_orders_select ON rental_orders FOR SELECT TO anon USING (true);
CREATE POLICY pol_anon_items_select ON rental_order_items FOR SELECT TO anon USING (true);
CREATE POLICY pol_anon_maintenance_select ON maintenance_records FOR SELECT TO anon USING (true);
CREATE POLICY pol_anon_inspections_select ON equipment_inspections FOR SELECT TO anon USING (true);
CREATE POLICY pol_anon_audit_select ON audit_logs FOR SELECT TO anon USING (true);
REVOKE ALL ON TABLE public.user_profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.user_profiles TO authenticated;
GRANT UPDATE (full_name, phone, company_name, updated_at)
    ON TABLE public.user_profiles TO authenticated;
CREATE POLICY pol_profiles_auth_select ON user_profiles
    FOR SELECT TO authenticated
    USING (
        auth_user_id = auth.uid()
        OR id = auth.uid()
        OR fn_current_user_role() IN ('admin', 'staff')
    );
CREATE POLICY pol_profiles_self_update ON user_profiles
    FOR UPDATE TO authenticated
    USING (auth_user_id = auth.uid() OR id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid() OR id = auth.uid());

-- Trigger to automatically synchronize new Supabase Auth users to user_profiles
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.user_profiles (
        id, auth_user_id, full_name, email, phone, company_name, role, requested_role, account_status
    ) VALUES (
        NEW.id,
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        NEW.email,
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone', ''), ''),
        NULLIF(NEW.raw_user_meta_data->>'company_name', ''),
        'customer',
        CASE
            WHEN NEW.raw_user_meta_data->>'requested_role' IN ('staff', 'admin')
                THEN (NEW.raw_user_meta_data->>'requested_role')::user_role_type
            ELSE NULL
        END,
        'active'
    )
    ON CONFLICT (email) DO UPDATE
    SET auth_user_id = EXCLUDED.auth_user_id,
        requested_role = CASE
            WHEN public.user_profiles.role = 'customer'::user_role_type THEN EXCLUDED.requested_role
            ELSE public.user_profiles.requested_role
        END,
        updated_at = NOW();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();



-- ----------------------------------------------------------------------------
-- Data remains empty until users create accounts and operators add live records.
