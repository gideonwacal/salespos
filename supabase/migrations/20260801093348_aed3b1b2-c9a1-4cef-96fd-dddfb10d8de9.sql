ALTER TABLE public.products ADD COLUMN IF NOT EXISTS expiry_date date;
ALTER TABLE public.stock_transactions ADD COLUMN IF NOT EXISTS expiry_date date;

CREATE TABLE IF NOT EXISTS public.damage_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1,
  reason text NOT NULL DEFAULT '',
  photo_url text,
  reported_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.damage_reports TO authenticated;
GRANT ALL ON public.damage_reports TO service_role;
ALTER TABLE public.damage_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "damage readable" ON public.damage_reports FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff log damage" ON public.damage_reports FOR INSERT TO authenticated WITH CHECK (reported_by = auth.uid());
CREATE POLICY "owner deletes damage" ON public.damage_reports FOR DELETE TO authenticated USING (public.is_owner());

CREATE OR REPLACE FUNCTION public.apply_damage_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.products SET stock_quantity = GREATEST(0, stock_quantity - NEW.quantity) WHERE id = NEW.product_id;
  INSERT INTO public.stock_transactions (product_id, type, quantity, notes, performed_by)
  VALUES (NEW.product_id, 'damage', NEW.quantity, COALESCE(NULLIF(NEW.reason,''), 'Damaged goods'), NEW.reported_by);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_damage_report() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_apply_damage_report ON public.damage_reports;
CREATE TRIGGER trg_apply_damage_report AFTER INSERT ON public.damage_reports
FOR EACH ROW EXECUTE FUNCTION public.apply_damage_report();

CREATE OR REPLACE FUNCTION public.sync_product_expiry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.expiry_date IS NOT NULL AND NEW.type = 'stock_in' THEN
    UPDATE public.products SET expiry_date = NEW.expiry_date WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_product_expiry() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_product_expiry ON public.stock_transactions;
CREATE TRIGGER trg_sync_product_expiry AFTER INSERT ON public.stock_transactions
FOR EACH ROW EXECUTE FUNCTION public.sync_product_expiry();

DROP POLICY IF EXISTS "owner inserts products" ON public.products;
DROP POLICY IF EXISTS "owner updates products" ON public.products;
CREATE POLICY "staff insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff update products" ON public.products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);