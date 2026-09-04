-- Products: bottle + tiered pricing config
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_glass_bottle boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bottles_per_unit integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS bulk_min_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bulk_discount_percent numeric NOT NULL DEFAULT 0;

-- Customers
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  notes text,
  bottles_owed integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers readable" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff insert customers" ON public.customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff update customers" ON public.customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "owner deletes customers" ON public.customers FOR DELETE TO authenticated USING (public.is_owner());

-- Debts (credit sales)
CREATE TABLE IF NOT EXISTS public.debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  items_summary text NOT NULL DEFAULT '',
  total_value numeric NOT NULL DEFAULT 0,
  amount_paid numeric NOT NULL DEFAULT 0,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date NOT NULL DEFAULT (CURRENT_DATE + 14),
  status text NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.debts TO authenticated;
GRANT ALL ON public.debts TO service_role;
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "debts readable" ON public.debts FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff insert debts" ON public.debts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff update debts" ON public.debts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "owner deletes debts" ON public.debts FOR DELETE TO authenticated USING (public.is_owner());

-- Debt payments
CREATE TABLE IF NOT EXISTS public.debt_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id uuid NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  payment_method text NOT NULL DEFAULT 'cash',
  note text,
  recorded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.debt_payments TO authenticated;
GRANT ALL ON public.debt_payments TO service_role;
ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "debt payments readable" ON public.debt_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff insert debt payments" ON public.debt_payments FOR INSERT TO authenticated WITH CHECK (recorded_by = auth.uid());
CREATE POLICY "owner deletes debt payments" ON public.debt_payments FOR DELETE TO authenticated USING (public.is_owner());

-- Bottle movements
CREATE TABLE IF NOT EXISTS public.bottle_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  direction text NOT NULL DEFAULT 'taken',
  quantity integer NOT NULL DEFAULT 0,
  note text,
  recorded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.bottle_movements TO authenticated;
GRANT ALL ON public.bottle_movements TO service_role;
ALTER TABLE public.bottle_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bottle movements readable" ON public.bottle_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff insert bottle movements" ON public.bottle_movements FOR INSERT TO authenticated WITH CHECK (recorded_by = auth.uid());
CREATE POLICY "owner deletes bottle movements" ON public.bottle_movements FOR DELETE TO authenticated USING (public.is_owner());

-- Keep customer bottle balance in sync
CREATE OR REPLACE FUNCTION public.apply_bottle_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.customers
  SET bottles_owed = GREATEST(0, bottles_owed + CASE WHEN NEW.direction = 'taken' THEN NEW.quantity ELSE -NEW.quantity END),
      updated_at = now()
  WHERE id = NEW.customer_id;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_bottle_movement() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_apply_bottle_movement ON public.bottle_movements;
CREATE TRIGGER trg_apply_bottle_movement AFTER INSERT ON public.bottle_movements
FOR EACH ROW EXECUTE FUNCTION public.apply_bottle_movement();

-- Keep debt totals/status in sync with payments
CREATE OR REPLACE FUNCTION public.apply_debt_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE paid numeric; tot numeric; due date;
BEGIN
  UPDATE public.debts SET amount_paid = amount_paid + NEW.amount, updated_at = now()
  WHERE id = NEW.debt_id
  RETURNING amount_paid, total_value, due_date INTO paid, tot, due;

  UPDATE public.debts SET status = CASE
    WHEN paid >= tot THEN 'cleared'
    WHEN due < CURRENT_DATE THEN 'overdue'
    WHEN paid > 0 THEN 'partially_paid'
    ELSE 'pending' END
  WHERE id = NEW.debt_id;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_debt_payment() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_apply_debt_payment ON public.debt_payments;
CREATE TRIGGER trg_apply_debt_payment AFTER INSERT ON public.debt_payments
FOR EACH ROW EXECUTE FUNCTION public.apply_debt_payment();

-- Timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_customers_updated ON public.customers;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_debts_updated ON public.debts;
CREATE TRIGGER trg_debts_updated BEFORE UPDATE ON public.debts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.debts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.debt_payments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bottle_movements;

-- Mark glass-bottle drinks and set bulk pricing defaults on drinks
UPDATE public.products SET is_glass_bottle = true, bottles_per_unit = 24
WHERE category IN ('Soft Drinks', 'Alcoholic Drinks');
UPDATE public.products SET bulk_min_qty = 6, bulk_discount_percent = 10
WHERE category IN ('Soft Drinks', 'Alcoholic Drinks');
