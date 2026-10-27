-- ====================================================================
-- EquipRent: Advanced Equipment Rental Management System
-- Initial PostgreSQL Schema Migration (3NF Compliant)
-- ====================================================================

BEGIN;

-- Drop existing tables in reverse dependency order for clean re-runs
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS maintenance_assignments CASCADE;
DROP TABLE IF EXISTS maintenance_records CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS rental_items CASCADE;
DROP TABLE IF EXISTS rentals CASCADE;
DROP TABLE IF EXISTS equipment CASCADE;
DROP TABLE IF EXISTS equipment_categories CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- =====================
-- 1. ROLES TABLE
-- =====================
CREATE TABLE roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================
-- 2. USERS TABLE
-- =====================
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    role_id INT NOT NULL,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    phone_number VARCHAR(20),
    street VARCHAR(100),
    barangay VARCHAR(100),
    city VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_role FOREIGN KEY (role_id) 
        REFERENCES roles(role_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- =====================
-- 3. CUSTOMERS TABLE
-- =====================
CREATE TABLE customers (
    customer_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    customer_type VARCHAR(50) DEFAULT 'Standard',
    CONSTRAINT fk_customer_user FOREIGN KEY (user_id) 
        REFERENCES users(user_id) 
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- =====================
-- 4. EQUIPMENT CATEGORIES
-- =====================
CREATE TABLE equipment_categories (
    category_id SERIAL PRIMARY KEY,
    category_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT
);

-- =====================
-- 5. EQUIPMENT TABLE
-- =====================
CREATE TABLE equipment (
    equipment_id SERIAL PRIMARY KEY,
    category_id INT NOT NULL,
    equipment_name VARCHAR(100) NOT NULL,
    description TEXT,
    rental_price NUMERIC(10, 2) NOT NULL CHECK (rental_price >= 0.00),
    equipment_status VARCHAR(30) NOT NULL DEFAULT 'Available',
    condition_status VARCHAR(30) NOT NULL DEFAULT 'Good',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_equipment_category FOREIGN KEY (category_id) 
        REFERENCES equipment_categories(category_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- =====================
-- 6. RENTALS TABLE
-- =====================
CREATE TABLE rentals (
    rental_id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL,
    staff_id INT NOT NULL,
    rental_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_return_date DATE NOT NULL,
    actual_return_date DATE,
    rental_status VARCHAR(30) NOT NULL DEFAULT 'Active',
    total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0.00),
    CONSTRAINT fk_rental_customer FOREIGN KEY (customer_id) 
        REFERENCES customers(customer_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_rental_staff FOREIGN KEY (staff_id) 
        REFERENCES users(user_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_rental_dates CHECK (expected_return_date >= rental_date)
);

-- =====================
-- 7. RENTAL ITEMS (N:M Junction Table)
-- =====================
CREATE TABLE rental_items (
    rental_item_id SERIAL PRIMARY KEY,
    rental_id INT NOT NULL,
    equipment_id INT NOT NULL,
    rental_price NUMERIC(10, 2) NOT NULL CHECK (rental_price >= 0.00),
    item_condition VARCHAR(50) DEFAULT 'Good',
    CONSTRAINT fk_item_rental FOREIGN KEY (rental_id) 
        REFERENCES rentals(rental_id) 
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_item_equipment FOREIGN KEY (equipment_id) 
        REFERENCES equipment(equipment_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- =====================
-- 8. PAYMENTS TABLE
-- =====================
CREATE TABLE payments (
    payment_id SERIAL PRIMARY KEY,
    rental_id INT NOT NULL,
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    amount_paid NUMERIC(10, 2) NOT NULL CHECK (amount_paid > 0.00),
    payment_method VARCHAR(50) NOT NULL,
    payment_status VARCHAR(30) NOT NULL DEFAULT 'Completed',
    CONSTRAINT fk_payment_rental FOREIGN KEY (rental_id) 
        REFERENCES rentals(rental_id) 
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- =====================
-- 9. MAINTENANCE RECORDS
-- =====================
CREATE TABLE maintenance_records (
    maintenance_id SERIAL PRIMARY KEY,
    equipment_id INT NOT NULL,
    requested_by INT NOT NULL,
    maintenance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT,
    maintenance_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
    CONSTRAINT fk_maint_equipment FOREIGN KEY (equipment_id) 
        REFERENCES equipment(equipment_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_maint_requester FOREIGN KEY (requested_by) 
        REFERENCES users(user_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- =====================
-- 10. MAINTENANCE ASSIGNMENTS (N:M Junction Table)
-- =====================
CREATE TABLE maintenance_assignments (
    assignment_id SERIAL PRIMARY KEY,
    maintenance_id INT NOT NULL,
    technician_id INT NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    assignment_status VARCHAR(30) NOT NULL DEFAULT 'Assigned',
    CONSTRAINT fk_assign_maintenance FOREIGN KEY (maintenance_id) 
        REFERENCES maintenance_records(maintenance_id) 
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_assign_technician FOREIGN KEY (technician_id) 
        REFERENCES users(user_id) 
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- =====================
-- 11. AUDIT LOGS TABLE
-- =====================
CREATE TABLE audit_logs (
    audit_id SERIAL PRIMARY KEY,
    user_id INT,
    action VARCHAR(50) NOT NULL,
    table_name VARCHAR(50) NOT NULL,
    record_id INT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id) 
        REFERENCES users(user_id) 
        ON DELETE SET NULL ON UPDATE CASCADE
);

-- =====================
-- STRATEGIC INDEXING FOR PERFORMANCE
-- =====================
CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_equipment_category ON equipment(category_id);
CREATE INDEX idx_equipment_status ON equipment(equipment_status);
CREATE INDEX idx_rentals_customer ON rentals(customer_id);
CREATE INDEX idx_rentals_status ON rentals(rental_status);
CREATE INDEX idx_rental_items_rental ON rental_items(rental_id);
CREATE INDEX idx_rental_items_equipment ON rental_items(equipment_id);
CREATE INDEX idx_payments_rental ON payments(rental_id);
CREATE INDEX idx_maintenance_equipment ON maintenance_records(equipment_id);
CREATE INDEX idx_audit_logs_table_record ON audit_logs(table_name, record_id);

COMMIT;