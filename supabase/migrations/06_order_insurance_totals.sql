-- Adds insurance as a first-class order amount for existing databases.
ALTER TABLE public.rental_orders
    ADD COLUMN IF NOT EXISTS insurance_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00
    CHECK (insurance_amount >= 0);

ALTER TABLE public.equipment_categories
    ALTER COLUMN base_daily_insurance_rate DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.fn_recalculate_order_financials()
RETURNS TRIGGER AS $$
DECLARE
    v_order_id UUID;
    v_new_subtotal NUMERIC(12, 2) := 0.00;
    v_new_insurance NUMERIC(12, 2) := 0.00;
    v_new_tax NUMERIC(12, 2) := 0.00;
    v_tax_rate NUMERIC(4, 2) := 0.08;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_order_id := OLD.rental_order_id;
    ELSE
        v_order_id := NEW.rental_order_id;
    END IF;

    SELECT COALESCE(SUM(item_subtotal), 0.00),
           COALESCE(SUM(daily_insurance_rate * days_rented), 0.00)
    INTO v_new_subtotal, v_new_insurance
    FROM public.rental_order_items
    WHERE rental_order_id = v_order_id;

    v_new_tax := ROUND((v_new_subtotal + v_new_insurance) * v_tax_rate, 2);

    UPDATE public.rental_orders
    SET subtotal_amount = v_new_subtotal,
        insurance_amount = v_new_insurance,
        tax_amount = v_new_tax,
        total_amount = v_new_subtotal + v_new_insurance + v_new_tax + security_deposit_amount,
        updated_at = NOW()
    WHERE id = v_order_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recalc_order_financials ON public.rental_order_items;
CREATE TRIGGER trg_recalc_order_financials
AFTER INSERT OR UPDATE OF item_subtotal, unit_daily_rate, daily_insurance_rate, days_rented OR DELETE
ON public.rental_order_items
FOR EACH ROW EXECUTE FUNCTION public.fn_recalculate_order_financials();
