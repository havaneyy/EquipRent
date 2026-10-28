-- ============================================================================
-- EQUIPRENT DATABASE ENGINEERING SPECIFICATION
-- MIGRATION 02: SERVER-SIDE AUTOMATION VIA OPERATIONAL TRIGGERS
-- Target: PostgreSQL 15+ / Supabase Cloud Database Cluster
-- Compliance: Automation over Application, Automatic Audit Diffing,
--             State Synchronization, Inventory Adjustment & Concurrency Guards
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. GENERIC UPDATED_AT TRIGGER FUNCTION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_profiles_updated_at
BEFORE UPDATE ON user_profiles
FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE TRIGGER trg_equipment_updated_at
BEFORE UPDATE ON equipment
FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE TRIGGER trg_rental_orders_updated_at
BEFORE UPDATE ON rental_orders
FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE TRIGGER trg_maintenance_records_updated_at
BEFORE UPDATE ON maintenance_records
FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. UNIVERSAL ENGINE-LEVEL AUDIT TRIGGER (Diffs Old vs New into audit_logs)
-- Complies with Page 2 mandate: "Systems must automatically handle log entries
-- and standard column adjustments directly at the database engine level."
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_universal_audit_logger()
RETURNS TRIGGER AS $$
DECLARE
    v_record_id VARCHAR(64);
    v_old_json JSONB := NULL;
    v_new_json JSONB := NULL;
    v_user_id UUID := NULL;
BEGIN
    -- Extract active user from Postgres session or fallback
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
        
        -- Do not log if data hasn't changed (ignoring updated_at)
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

-- Bind Universal Audit Triggers to Critical Entities
DROP TRIGGER IF EXISTS trg_audit_equipment ON equipment;
CREATE TRIGGER trg_audit_equipment
AFTER INSERT OR UPDATE OR DELETE ON equipment
FOR EACH ROW EXECUTE FUNCTION fn_universal_audit_logger();

DROP TRIGGER IF EXISTS trg_audit_rental_orders ON rental_orders;
CREATE TRIGGER trg_audit_rental_orders
AFTER INSERT OR UPDATE OR DELETE ON rental_orders
FOR EACH ROW EXECUTE FUNCTION fn_universal_audit_logger();

DROP TRIGGER IF EXISTS trg_audit_rental_order_items ON rental_order_items;
CREATE TRIGGER trg_audit_rental_order_items
AFTER INSERT OR UPDATE OR DELETE ON rental_order_items
FOR EACH ROW EXECUTE FUNCTION fn_universal_audit_logger();

DROP TRIGGER IF EXISTS trg_audit_maintenance_records ON maintenance_records;
CREATE TRIGGER trg_audit_maintenance_records
AFTER INSERT OR UPDATE OR DELETE ON maintenance_records
FOR EACH ROW EXECUTE FUNCTION fn_universal_audit_logger();

DROP TRIGGER IF EXISTS trg_audit_payment_transactions ON payment_transactions;
CREATE TRIGGER trg_audit_payment_transactions
AFTER INSERT OR UPDATE OR DELETE ON payment_transactions
FOR EACH ROW EXECUTE FUNCTION fn_universal_audit_logger();

-- ----------------------------------------------------------------------------
-- 3. AUTOMATIC INVENTORY/EQUIPMENT STATUS ADJUSTMENT TRIGGER
-- Auto-syncs physical unit availability based on rental lifecycle changes
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_sync_equipment_rental_status()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        IF NEW.item_status = 'dispatched' THEN
            UPDATE equipment
            SET current_status = 'rented'
            WHERE id = NEW.equipment_id;
        ELSIF NEW.item_status = 'returned' THEN
            -- Check if returned with damage notes or flagged in inspection
            IF NEW.condition_notes ILIKE '%damage%' OR NEW.condition_notes ILIKE '%repair%' THEN
                UPDATE equipment
                SET current_status = 'under_maintenance',
                    operational_hours = COALESCE(NEW.return_odometer_hours, operational_hours)
                WHERE id = NEW.equipment_id;
            ELSE
                UPDATE equipment
                SET current_status = 'available',
                    operational_hours = COALESCE(NEW.return_odometer_hours, operational_hours)
                WHERE id = NEW.equipment_id;
            END IF;
        ELSIF NEW.item_status = 'damaged' THEN
            UPDATE equipment
            SET current_status = 'under_maintenance',
                operational_hours = COALESCE(NEW.return_odometer_hours, operational_hours)
            WHERE id = NEW.equipment_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_equipment_status ON rental_order_items;
CREATE TRIGGER trg_sync_equipment_status
AFTER INSERT OR UPDATE OF item_status, return_odometer_hours ON rental_order_items
FOR EACH ROW EXECUTE FUNCTION fn_sync_equipment_rental_status();

-- ----------------------------------------------------------------------------
-- 4. FINANCIAL AGGREGATION TRIGGER (Automates Order Totals Recalculation)
-- Prevents client-side price tampering by recalculating subtotal and tax on order header
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_recalculate_order_financials()
RETURNS TRIGGER AS $$
DECLARE
    v_order_id UUID;
    v_new_subtotal NUMERIC(12, 2) := 0.00;
    v_new_insurance NUMERIC(12, 2) := 0.00;
    v_new_tax NUMERIC(12, 2) := 0.00;
    v_tax_rate NUMERIC(4, 2) := 0.08; -- 8% sales / rental equipment tax
BEGIN
    IF (TG_OP = 'DELETE') THEN
        v_order_id := OLD.rental_order_id;
    ELSE
        v_order_id := NEW.rental_order_id;
    END IF;

    -- Aggregate subtotal from line items
    SELECT COALESCE(SUM(item_subtotal), 0.00)
    INTO v_new_subtotal
    FROM rental_order_items
    WHERE rental_order_id = v_order_id;

    SELECT COALESCE(SUM(daily_insurance_rate * days_rented), 0.00)
    INTO v_new_insurance
    FROM rental_order_items
    WHERE rental_order_id = v_order_id;

    v_new_tax := ROUND((v_new_subtotal + v_new_insurance) * v_tax_rate, 2);

    -- Update parent order
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

DROP TRIGGER IF EXISTS trg_recalc_order_financials ON rental_order_items;
CREATE TRIGGER trg_recalc_order_financials
AFTER INSERT OR UPDATE OF item_subtotal, unit_daily_rate, daily_insurance_rate, days_rented OR DELETE ON rental_order_items
FOR EACH ROW EXECUTE FUNCTION fn_recalculate_order_financials();

-- ----------------------------------------------------------------------------
-- 5. CONCURRENCY & OVERLAP GUARD TRIGGER (Prevents Double-Booking)
-- Solves Theme 1 / Logistics requirement: strict isolation to prevent duplicate allocation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_guard_prevent_double_booking()
RETURNS TRIGGER AS $$
DECLARE
    v_order_start DATE;
    v_order_end DATE;
    v_collision_count INT;
    v_equip_status equipment_status_type;
BEGIN
    -- Check physical status first
    SELECT current_status INTO v_equip_status
    FROM equipment
    WHERE id = NEW.equipment_id;

    IF v_equip_status = 'decommissioned' THEN
        RAISE EXCEPTION 'Database Integrity Error: Equipment % is decommissioned and cannot be rented.', NEW.equipment_id;
    END IF;

    -- Retrieve proposed booking dates from the parent rental_orders
    SELECT expected_start_date, expected_end_date
    INTO v_order_start, v_order_end
    FROM rental_orders
    WHERE id = NEW.rental_order_id;

    -- Check for overlapping active or reserved rentals for the exact same unit
    SELECT COUNT(*)
    INTO v_collision_count
    FROM rental_order_items roi
    JOIN rental_orders ro ON ro.id = roi.rental_order_id
    WHERE roi.equipment_id = NEW.equipment_id
      AND roi.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
      AND roi.item_status IN ('reserved', 'dispatched')
      AND ro.status IN ('confirmed', 'in_progress')
      AND (
          (ro.expected_start_date <= v_order_end) AND (ro.expected_end_date >= v_order_start)
      );

    IF v_collision_count > 0 THEN
        RAISE EXCEPTION 'Double-Booking Violation: Equipment unit % is already booked or dispatched for an overlapping date range (% to %).',
            NEW.equipment_id, v_order_start, v_order_end;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_double_booking ON rental_order_items;
CREATE TRIGGER trg_guard_double_booking
BEFORE INSERT OR UPDATE OF equipment_id, rental_order_id, item_status ON rental_order_items
FOR EACH ROW EXECUTE FUNCTION fn_guard_prevent_double_booking();
