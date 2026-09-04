
-- ROLES
CREATE TYPE public.app_role AS ENUM ('owner_kampala', 'manager_serere');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'owner_kampala');
$$;

CREATE POLICY "profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY "roles readable by authenticated" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "owner manages roles" ON public.user_roles FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE first_user boolean;
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), NEW.raw_user_meta_data->>'phone');

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO first_user;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN first_user THEN 'owner_kampala'::public.app_role ELSE 'manager_serere'::public.app_role END);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- PRODUCTS
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'General Merchandise',
  unit_buying_price numeric(14,2) NOT NULL DEFAULT 0,
  unit_selling_price numeric(14,2) NOT NULL DEFAULT 0,
  wholesale_price numeric(14,2),
  stock_quantity integer NOT NULL DEFAULT 0,
  reorder_level integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products readable" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "owner inserts products" ON public.products FOR INSERT TO authenticated WITH CHECK (public.is_owner());
CREATE POLICY "owner updates products" ON public.products FOR UPDATE TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE POLICY "owner deletes products" ON public.products FOR DELETE TO authenticated USING (public.is_owner());

-- STOCK TRANSACTIONS
CREATE TABLE public.stock_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('stock_in','sale','adjustment','damage')),
  quantity integer NOT NULL,
  notes text NOT NULL DEFAULT '',
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.stock_transactions TO authenticated;
GRANT ALL ON public.stock_transactions TO service_role;
ALTER TABLE public.stock_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock readable" ON public.stock_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff log stock" ON public.stock_transactions FOR INSERT TO authenticated WITH CHECK (performed_by = auth.uid());
CREATE POLICY "owner deletes stock" ON public.stock_transactions FOR DELETE TO authenticated USING (public.is_owner());

CREATE OR REPLACE FUNCTION public.apply_stock_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.products
  SET stock_quantity = GREATEST(0, stock_quantity + CASE
      WHEN NEW.type = 'stock_in' THEN NEW.quantity
      WHEN NEW.type = 'adjustment' THEN NEW.quantity
      ELSE -ABS(NEW.quantity) END)
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_apply_stock AFTER INSERT ON public.stock_transactions
FOR EACH ROW EXECUTE FUNCTION public.apply_stock_transaction();

-- SALES
CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_type text NOT NULL DEFAULT 'retail' CHECK (sale_type IN ('wholesale','retail')),
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_cost numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash',
  customer_name text,
  cashier_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales readable" ON public.sales FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff create sales" ON public.sales FOR INSERT TO authenticated WITH CHECK (cashier_id = auth.uid());
CREATE POLICY "owner deletes sales" ON public.sales FOR DELETE TO authenticated USING (public.is_owner());

CREATE TABLE public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL,
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  subtotal numeric(14,2) NOT NULL
);
GRANT SELECT, INSERT, DELETE ON public.sale_items TO authenticated;
GRANT ALL ON public.sale_items TO service_role;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sale items readable" ON public.sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff create sale items" ON public.sale_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.cashier_id = auth.uid()));
CREATE POLICY "owner deletes sale items" ON public.sale_items FOR DELETE TO authenticated USING (public.is_owner());

CREATE OR REPLACE FUNCTION public.apply_sale_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cashier uuid;
BEGIN
  SELECT s.cashier_id INTO cashier FROM public.sales s WHERE s.id = NEW.sale_id;
  UPDATE public.products SET stock_quantity = GREATEST(0, stock_quantity - NEW.quantity) WHERE id = NEW.product_id;
  INSERT INTO public.stock_transactions (product_id, type, quantity, notes, performed_by)
  VALUES (NEW.product_id, 'sale', NEW.quantity, 'POS sale', cashier);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_apply_sale_item AFTER INSERT ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION public.apply_sale_item();

-- EXPENSES
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  amount numeric(14,2) NOT NULL,
  description text,
  vendor text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL DEFAULT 'cash',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  logged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses readable" ON public.expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff log expenses" ON public.expenses FOR INSERT TO authenticated WITH CHECK (logged_by = auth.uid());
CREATE POLICY "owner updates expenses" ON public.expenses FOR UPDATE TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE POLICY "owner deletes expenses" ON public.expenses FOR DELETE TO authenticated USING (public.is_owner());

-- REALTIME
ALTER TABLE public.products REPLICA IDENTITY FULL;
ALTER TABLE public.sales REPLICA IDENTITY FULL;
ALTER TABLE public.expenses REPLICA IDENTITY FULL;
ALTER TABLE public.stock_transactions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;
ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_transactions;

-- SEED PRODUCTS
INSERT INTO public.products (name, category, unit_buying_price, unit_selling_price, wholesale_price, stock_quantity, reorder_level) VALUES
('Bebwine Sachet 100ml','Alcoholic Drinks',600,1000,850,480,100),
('Bebwine Bottle 250ml','Alcoholic Drinks',1800,2500,2200,120,30),
('Lavida Waragi 200ml','Alcoholic Drinks',1500,2200,1900,96,24),
('Teju Gin Sachet','Alcoholic Drinks',550,1000,800,600,120),
('Jaja Sachet 100ml','Alcoholic Drinks',600,1000,850,240,80),
('Kituzi Waragi 250ml','Alcoholic Drinks',1700,2500,2100,72,24),
('Kabisa Energy Drink 300ml','Soft Drinks',1400,2000,1700,144,36),
('Coca Cola 500ml','Soft Drinks',1100,1500,1300,240,48),
('Fanta Orange 500ml','Soft Drinks',1100,1500,1300,180,48),
('Mirinda Pineapple 500ml','Soft Drinks',1100,1500,1300,96,48),
('Rwenzori Water 1.5L','Soft Drinks',1000,1500,1250,150,40),
('Novida Pineapple 300ml','Soft Drinks',1200,1800,1500,84,36),
('Mukwano Cooking Oil 1L','Household Items',6500,8000,7300,60,15),
('Omo Washing Powder 500g','Household Items',3800,5000,4400,80,20),
('Blue Band Margarine 250g','Household Items',4200,5500,4900,45,12),
('Kimbo Cooking Fat 500g','Household Items',5000,6500,5800,36,12),
('Colgate Toothpaste 100ml','Household Items',3000,4500,3800,54,15),
('Geisha Soap Bar','Household Items',1800,2500,2200,120,30),
('Sugar (Kakira) 1kg','General Merchandise',4200,5000,4600,200,50),
('Rice (Super) 1kg','General Merchandise',3800,4500,4200,150,40),
('Matches Box (Pack of 10)','General Merchandise',1200,2000,1600,90,20),
('Exercise Books (Pack of 12)','General Merchandise',9000,12000,10500,40,10),
('Torch Batteries (Pair)','General Merchandise',900,1500,1200,160,40),
('Airtime Scratch Cards 1000','General Merchandise',950,1000,980,300,100);

-- SEED EXPENSES
INSERT INTO public.expenses (category, amount, description, vendor, expense_date, payment_method, status) VALUES
('Power/Electricity',85000,'Yaka units for shop and fridges','UMEME', CURRENT_DATE - 2,'mobile_money','approved'),
('Transport & Freight',150000,'Truck hire Kampala to Serere','Ssekabira Transporters', CURRENT_DATE - 3,'cash','approved'),
('Offloading/Handling',30000,'Offloading drinks crates','Casual Labourers', CURRENT_DATE - 3,'cash','approved'),
('Shop Rent',400000,'Monthly rent Orupe Road shop','Landlord Okello', CURRENT_DATE - 5,'bank_transfer','approved'),
('Staff Wages',250000,'Fortnight wages for two attendants','Shop Staff', CURRENT_DATE - 1,'mobile_money','pending'),
('Local Taxes',60000,'Ocaapa Town Council trading licence instalment','Town Council', CURRENT_DATE - 6,'cash','approved'),
('Miscellaneous',18000,'Airtime and printing receipts','Various', CURRENT_DATE,'cash','pending'),
('Power/Electricity',40000,'Generator fuel during blackout','Shell Serere', CURRENT_DATE,'cash','pending');
