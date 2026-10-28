-- ============================================================================
-- EQUIPRENT DATABASE ENGINEERING SPECIFICATION
-- MIGRATION 01: CORE RELATIONAL SCHEMA & 3NF DATA INTEGRITY
-- Target: PostgreSQL 15+ / Supabase Cloud Database Cluster
-- Compliance: 3NF Normalized, Strict Foreign Keys, Composite Keys, Check Constraints
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing tables in reverse dependency order if rebuilding
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

-- Drop custom types if they exist
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
-- CUSTOM ENUMERATIONS (Domain Constraints)
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

-- ----------------------------------------------------------------------------
-- TABLE 1: USER PROFILES (Separating Auth Credentials from Profile Data - 3NF)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- TABLE 2: WAREHOUSE LOCATIONS (Physical Depot Master)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- TABLE 3: EQUIPMENT CATEGORIES (Normalized Classification & Insurance Specs)
-- ----------------------------------------------------------------------------
CREATE TABLE equipment_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_name VARCHAR(80) NOT NULL UNIQUE,
    category_code VARCHAR(20) NOT NULL UNIQUE,
    description TEXT,
    base_daily_insurance_rate NUMERIC(10, 2) NOT NULL CHECK (base_daily_insurance_rate >= 0),
    requires_operator_certification BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- TABLE 4: EQUIPMENT (Physical Asset Master & Fleet Tracking)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- TABLE 5: RENTAL ORDERS (Core Transaction Header - Parent Entity)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- TABLE 6: RENTAL ORDER ITEMS (MANDATORY COMPLEX JUNCTION TABLE 1: N:M)
-- Connects Orders <-> Equipment with rich intersection attributes
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- TABLE 7: PAYMENT TRANSACTIONS (Financial Audit Trail)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- TABLE 8: MAINTENANCE RECORDS (Fleet Servicing & Compliance Parent)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- TABLE 9: MAINTENANCE TASKS (MANDATORY COMPLEX JUNCTION TABLE 2: N:M)
-- Connects Maintenance Work Orders <-> Technicians with intersection attributes
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- TABLE 10: EQUIPMENT INSPECTIONS (Check-in/Check-out Multi-Attribute Audit)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- TABLE 11: AUDIT LOGS (Database Engine-Level Security & Mutation Tracking)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- HIGH-PERFORMANCE INDEXING STRATEGY (Composite & Foreign Key Optimization)
-- ----------------------------------------------------------------------------
CREATE INDEX idx_equipment_category_status ON equipment(category_id, current_status);
CREATE INDEX idx_equipment_warehouse ON equipment(warehouse_id);
CREATE INDEX idx_rental_orders_customer_status ON rental_orders(customer_id, status);
CREATE INDEX idx_rental_order_items_composite ON rental_order_items(rental_order_id, equipment_id, item_status);
CREATE INDEX idx_maintenance_records_equip_status ON maintenance_records(equipment_id, maintenance_status);
CREATE INDEX idx_maintenance_tasks_tech ON maintenance_tasks(technician_id, progress_status);
CREATE INDEX idx_inspections_order_item ON equipment_inspections(rental_order_item_id);
CREATE INDEX idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_logs_executed_at ON audit_logs(executed_at DESC);
