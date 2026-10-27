-- ====================================================================
-- EquipRent: Database Automation (Audit Triggers & Stored Procedures)
-- ====================================================================

BEGIN;

-- ====================================================================
-- 1. UNIVERSAL AUDIT LOGGING FUNCTION & TRIGGERS
-- ====================================================================

CREATE OR REPLACE FUNCTION process_audit_log_func()
RETURNS TRIGGER AS $$
DECLARE
    actor_id INT;
    record_identifier INT;
    old_data TEXT := NULL;
    new_data TEXT := NULL;
BEGIN
    -- Extract acting user from session settings if available, else default to null
    BEGIN
        actor_id := NULLIF(current_setting('equiprent.current_user_id', true), '')::INT;
    EXCEPTION WHEN OTHERS THEN
        actor_id := NULL;
    END;

    IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
        old_data := to_jsonb(OLD)::TEXT;
    END IF;

    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        new_data := to_jsonb(NEW)::TEXT;
    END IF;

    -- Resolve primary key identifier based on table name
    IF TG_TABLE_NAME = 'roles' THEN record_identifier := COALESCE(NEW.role_id, OLD.role_id);
    ELSIF TG_TABLE_NAME = 'users' THEN record_identifier := COALESCE(NEW.user_id, OLD.user_id);
    ELSIF TG_TABLE_NAME = 'customers' THEN record_identifier := COALESCE(NEW.customer_id, OLD.customer_id);
    ELSIF TG_TABLE_NAME = 'equipment_categories' THEN record_identifier := COALESCE(NEW.category_id, OLD.category_id);
    ELSIF TG_TABLE_NAME = 'equipment' THEN record_identifier := COALESCE(NEW.equipment_id, OLD.equipment_id);
    ELSIF TG_TABLE_NAME = 'rentals' THEN record_identifier := COALESCE(NEW.rental_id, OLD.rental_id);
    ELSIF TG_TABLE_NAME = 'rental_items' THEN record_identifier := COALESCE(NEW.rental_item_id, OLD.rental_item_id);
    ELSIF TG_TABLE_NAME = 'payments' THEN record_identifier := COALESCE(NEW.payment_id, OLD.payment_id);
    ELSIF TG_TABLE_NAME = 'maintenance_records' THEN record_identifier := COALESCE(NEW.maintenance_id, OLD.maintenance_id);
    ELSIF TG_TABLE_NAME = 'maintenance_assignments' THEN record_identifier := COALESCE(NEW.assignment_id, OLD.assignment_id);
    END IF;

    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value)
    VALUES (actor_id, TG_OP, TG_TABLE_NAME, COALESCE(record_identifier, 0), old_data, new_data);

    IF (TG_OP = 'DELETE') THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach Audit Triggers to Key Operational Tables
CREATE TRIGGER audit_equipment_changes
    AFTER INSERT OR UPDATE OR DELETE ON equipment
    FOR EACH ROW EXECUTE FUNCTION process_audit_log_func();

CREATE TRIGGER audit_rentals_changes
    AFTER INSERT OR UPDATE OR DELETE ON rentals
    FOR EACH ROW EXECUTE FUNCTION process_audit_log_func();

CREATE TRIGGER audit_users_changes
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION process_audit_log_func();


-- ====================================================================
-- 2. STORED PROCEDURE: CREATE RENTAL TRANSACTION
-- ====================================================================
-- Safely handles creating a rental header, linking equipment items, 
-- recording price snapshots, and marking equipment as 'Rented'.

CREATE OR REPLACE PROCEDURE sp_create_rental(
    p_customer_id INT,
    p_staff_id INT,
    p_expected_return_date DATE,
    p_equipment_ids INT[],
    INOUT p_rental_id INT DEFAULT NULL
)
AS $$
DECLARE
    v_total_amount NUMERIC(10, 2) := 0.00;
    v_eq_id INT;
    v_eq_price NUMERIC(10, 2);
    v_eq_status VARCHAR(30);
BEGIN
    -- 1. Validate that all requested equipment items are available
    FOREACH v_eq_id IN ARRAY p_equipment_ids LOOP
        SELECT rental_price, equipment_status INTO v_eq_price, v_eq_status
        FROM equipment WHERE equipment_id = v_eq_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Equipment ID % does not exist.', v_eq_id;
        END IF;

        IF v_eq_status <> 'Available' THEN
            RAISE EXCEPTION 'Equipment ID % is currently unavailable (Status: %).', v_eq_id, v_eq_status;
        END IF;

        v_total_amount := v_total_amount + v_eq_price;
    END LOOP;

    -- 2. Insert into rentals header table
    INSERT INTO rentals (customer_id, staff_id, expected_return_date, total_amount, rental_status)
    VALUES (p_customer_id, p_staff_id, p_expected_return_date, v_total_amount, 'Active')
    RETURNING rental_id INTO p_rental_id;

    -- 3. Insert rental items (price snapshots) and update equipment status
    FOREACH v_eq_id IN ARRAY p_equipment_ids LOOP
        SELECT rental_price INTO v_eq_price
        FROM equipment WHERE equipment_id = v_eq_id;

        INSERT INTO rental_items (rental_id, equipment_id, rental_price, item_condition)
        VALUES (p_rental_id, v_eq_id, v_eq_price, 'Good');

        UPDATE equipment
        SET equipment_status = 'Rented'
        WHERE equipment_id = v_eq_id;
    END LOOP;

    COMMIT;
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    RAISE;
END;
$$ LANGUAGE plpgsql;

COMMIT;