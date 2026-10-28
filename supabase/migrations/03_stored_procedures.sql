-- ============================================================================
-- EQUIPRENT DATABASE ENGINEERING SPECIFICATION
-- MIGRATION 03: SERVER-SIDE STORED PROCEDURES & TRANSACTION ROUTINES
-- Target: PostgreSQL 15+ / Supabase Cloud Database Cluster
-- Compliance: Complex Business Rules inside Database Engine,
--             ACID Transaction Isolation, Error Handling, Parameterized Logic
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STORED PROCEDURE 1: RENTAL ORDER CHECKOUT (DISPATCH WORKFLOW)
-- Handles the multi-table dispatch transaction:
-- Validates staff credentials, verifies equipment readiness, records dispatch
-- odometer readings, transitions item and fleet states, and updates order status.
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
    -- 1. Security & RBAC check: Staff must exist and have staff/admin privileges
    SELECT role INTO v_staff_role
    FROM user_profiles
    WHERE id = p_staff_id;

    IF v_staff_role IS NULL OR v_staff_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'Authorization Error: Provided user % is not authorized to dispatch equipment.', p_staff_id;
    END IF;

    -- 2. Validate Order State
    SELECT status INTO v_order_status
    FROM rental_orders
    WHERE id = p_order_id;

    IF v_order_status IS NULL THEN
        RAISE EXCEPTION 'Entity Not Found: Rental order % does not exist.', p_order_id;
    END IF;

    IF v_order_status NOT IN ('draft', 'confirmed') THEN
        RAISE EXCEPTION 'Invalid State Transition: Cannot checkout order % with current status "%".', p_order_id, v_order_status;
    END IF;

    -- 3. Verify all associated equipment items are currently available
    SELECT COUNT(*)
    INTO v_unavailable_item_count
    FROM rental_order_items roi
    JOIN equipment e ON e.id = roi.equipment_id
    WHERE roi.rental_order_id = p_order_id
      AND e.current_status <> 'available';

    IF v_unavailable_item_count > 0 THEN
        RAISE EXCEPTION 'Equipment Allocation Conflict: % unit(s) in this order are currently not in available status.', v_unavailable_item_count;
    END IF;

    -- 4. Dispatch line items & snapshot current odometer
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

    -- 5. Transition parent rental order to in_progress
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

-- ----------------------------------------------------------------------------
-- STORED PROCEDURE 2: EQUIPMENT RETURN & INSPECTION PIPELINE
-- Handles equipment check-in, odometer verification, penalty calculations,
-- inspection logging, wear-and-tear thresholds, and automatic maintenance triggering.
-- ----------------------------------------------------------------------------
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
    v_equip_hours NUMERIC;
    v_maintenance_created BOOLEAN := FALSE;
    v_maintenance_id UUID := NULL;
    v_result JSONB;
BEGIN
    -- 1. Validate Inspector Role
    SELECT role INTO v_inspector_role
    FROM user_profiles
    WHERE id = p_inspector_id;

    IF v_inspector_role IS NULL OR v_inspector_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'Authorization Error: Inspector % is not authorized to conduct return inspections.', p_inspector_id;
    END IF;

    -- 2. Fetch Order Item Data
    SELECT roi.*, e.maintenance_interval_hours, e.model_name
    INTO v_item
    FROM rental_order_items roi
    JOIN equipment e ON e.id = roi.equipment_id
    WHERE roi.id = p_order_item_id;

    IF v_item.id IS NULL THEN
        RAISE EXCEPTION 'Entity Not Found: Rental order item % does not exist.', p_order_item_id;
    END IF;

    IF v_item.item_status <> 'dispatched' THEN
        RAISE EXCEPTION 'Invalid State Transition: Item % is in "%" status, cannot be returned.', p_order_item_id, v_item.item_status;
    END IF;

    -- 3. Validate Odometer
    IF p_return_odometer < COALESCE(v_item.dispatch_odometer_hours, 0) THEN
        RAISE EXCEPTION 'Odometer Validation Error: Return hours (%) cannot be less than dispatch hours (%).',
            p_return_odometer, v_item.dispatch_odometer_hours;
    END IF;

    v_parent_order_id := v_item.rental_order_id;
    v_has_damage := (p_integrity <= 2 OR (p_damage_notes IS NOT NULL AND length(trim(p_damage_notes)) > 0) OR p_penalty_fee > 0);
    v_new_item_status := CASE WHEN v_has_damage THEN 'damaged'::item_rental_status ELSE 'returned'::item_rental_status END;

    -- 4. Create Formal Inspection Record
    INSERT INTO equipment_inspections (
        rental_order_item_id,
        inspector_id,
        inspection_type,
        fuel_level_percent,
        odometer_reading,
        cleanliness_rating,
        structural_integrity_rating,
        damage_identified,
        damage_assessment_notes,
        penalty_fee,
        sign_off_status
    ) VALUES (
        p_order_item_id,
        p_inspector_id,
        'post_return',
        p_fuel_level,
        p_return_odometer,
        p_cleanliness,
        p_integrity,
        v_has_damage,
        p_damage_notes,
        COALESCE(p_penalty_fee, 0.00),
        TRUE
    );

    -- 5. Update Line Item Status and Timestamp
    UPDATE rental_order_items
    SET item_status = v_new_item_status,
        return_odometer_hours = p_return_odometer,
        returned_at = NOW(),
        condition_notes = p_damage_notes
    WHERE id = p_order_item_id;

    -- 6. Trigger Preventive or Damage Maintenance Work Order if required
    IF v_has_damage OR (p_return_odometer >= v_item.maintenance_interval_hours) THEN
        INSERT INTO maintenance_records (
            work_order_number,
            equipment_id,
            maintenance_type,
            maintenance_status,
            scheduled_date,
            odometer_hours_at_service,
            lead_technician_id,
            service_description
        ) VALUES (
            'WO-' || to_char(NOW(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6),
            v_item.equipment_id,
            CASE WHEN v_has_damage THEN 'emergency_repair'::maintenance_type_enum ELSE 'scheduled_routine'::maintenance_type_enum END,
            'pending'::maintenance_status_enum,
            CURRENT_DATE,
            p_return_odometer,
            p_inspector_id,
            CASE WHEN v_has_damage
                THEN 'Post-return damage repair: ' || COALESCE(p_damage_notes, 'Physical inspection failure')
                ELSE 'Routine service milestone exceeded (' || p_return_odometer || ' hours logged)'
            END
        )
        RETURNING id INTO v_maintenance_id;

        v_maintenance_created := TRUE;
    END IF;

    -- 7. Check if all items in parent order are now returned/closed
    SELECT COUNT(*)
    INTO v_remaining_dispatched
    FROM rental_order_items
    WHERE rental_order_id = v_parent_order_id
      AND item_status = 'dispatched';

    IF v_remaining_dispatched = 0 THEN
        UPDATE rental_orders
        SET status = 'completed',
            actual_return_date = CURRENT_DATE,
            updated_at = NOW()
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

-- ----------------------------------------------------------------------------
-- STORED FUNCTION 3: FLEET UTILIZATION & FINANCIAL ANALYTICS
-- Server-side aggregation calculation routine
-- ----------------------------------------------------------------------------
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
