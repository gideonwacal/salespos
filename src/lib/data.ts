import { useQuery } from "@tanstack/react-query";
import { selectRows } from "@/lib/db";
import { type AccountUser, type Business } from "@/lib/demo";

export type Product = {
  id: string;
  name: string;
  category: string;
  unit_buying_price: number;
  unit_selling_price: number;
  wholesale_price: number | null;
  stock_quantity: number;
  reorder_level: number;
  expiry_date: string | null;
  /* Industry-specific: only surfaced by the profile that uses them. */
  barcode?: string;
  unit_of_measure?: string;
  batch_number?: string;
  prescription_only?: boolean;
  is_glass_bottle: boolean;
  bottles_per_unit: number;
  bulk_min_qty: number;
  bulk_discount_percent: number;
  created_at: string;
};

export type DamageReport = {
  id: string;
  product_id: string;
  quantity: number;
  reason: string | null;
  photo_url: string | null;
  reported_by: string | null;
  created_at: string;
};

/** One line of a sale, in the shape both backends are normalised into. */
export type SaleLine = {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
};

export type Sale = {
  id: string;
  sale_type: string;
  total_amount: number;
  total_cost: number;
  payment_method: string;
  customer_name: string | null;
  cashier_id: string | null;
  created_at: string;
  /** Nested by the API; absent on locally-stored sales. */
  items?: unknown[];
};

export type Expense = {
  id: string;
  category: string;
  amount: number;
  description: string | null;
  vendor: string | null;
  expense_date: string;
  payment_method: string;
  status: string;
  logged_by: string | null;
  created_at: string;
};

export type StockTxn = {
  id: string;
  product_id: string;
  type: string;
  quantity: number;
  notes: string;
  expiry_date: string | null;
  performed_by: string | null;
  created_at: string;
};

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  bottles_owed: number;
  created_at: string;
  updated_at: string;
};

export type DebtStatus = "pending" | "partially_paid" | "overdue" | "cleared";

export type Debt = {
  id: string;
  customer_id: string;
  sale_id: string | null;
  items_summary: string;
  total_value: number;
  amount_paid: number;
  issue_date: string;
  due_date: string;
  status: DebtStatus;
  created_at: string;
  updated_at: string;
};

export type DebtPayment = {
  id: string;
  debt_id: string;
  amount: number;
  payment_method: string;
  note: string | null;
  created_at: string;
};

export type BottleMovement = {
  id: string;
  customer_id: string;
  sale_id: string | null;
  direction: "taken" | "returned";
  quantity: number;
  note: string | null;
  created_at: string;
};

/** Days until expiry; negative when already expired, null when no date set. */
export function daysToExpiry(date: string | null | undefined): number | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export const EXPIRY_WARNING_DAYS = 30;

/** Live debt status — recomputed client-side so overdue shows up without a cron job. */
export function debtStatus(d: Debt): DebtStatus {
  const outstanding = Number(d.total_value) - Number(d.amount_paid);
  if (outstanding <= 0) return "cleared";
  if (d.due_date < new Date().toISOString().slice(0, 10)) return "overdue";
  return Number(d.amount_paid) > 0 ? "partially_paid" : "pending";
}

export function outstanding(d: Debt) {
  return Math.max(0, Number(d.total_value) - Number(d.amount_paid));
}

type Opts = { orderBy?: string; ascending?: boolean; limit?: number };

function useTable<T>(key: string, table: string, opts: Opts = {}) {
  const { orderBy, ascending = false, limit } = opts;
  return useQuery({
    queryKey: [key],
    queryFn: async (): Promise<T[]> => {
      // selectRows routes to Django or the local store per table; sorting stays
      // here so both backends return rows in the same order.
      const rows = (await selectRows<Record<string, unknown>>(table, limit)).slice();
      if (orderBy) {
        rows.sort((a, b) => {
          const x = String(a[orderBy] ?? "");
          const y = String(b[orderBy] ?? "");
          return ascending ? x.localeCompare(y) : y.localeCompare(x);
        });
      }
      return (limit ? rows.slice(0, limit) : rows) as T[];
    },
  });
}

export function useProducts() {
  return useTable<Product>("products", "products", { orderBy: "name", ascending: true });
}

export function useDamageReports() {
  return useTable<DamageReport>("damage_reports", "damage_reports", {
    orderBy: "created_at",
    limit: 200,
  });
}

export function useSales() {
  return useTable<Sale>("sales", "sales", { orderBy: "created_at", limit: 500 });
}

export function useExpenses() {
  return useTable<Expense>("expenses", "expenses", { orderBy: "expense_date", limit: 500 });
}

export function useStockTransactions() {
  return useTable<StockTxn>("stock_transactions", "stock_transactions", {
    orderBy: "created_at",
    limit: 200,
  });
}

export function useCustomers() {
  return useTable<Customer>("customers", "customers", { orderBy: "name", ascending: true });
}

export function useDebts() {
  return useTable<Debt>("debts", "debts", { orderBy: "due_date", ascending: true });
}

export function useDebtPayments() {
  return useTable<DebtPayment>("debt_payments", "debt_payments", {
    orderBy: "created_at",
    limit: 500,
  });
}

export function useBottleMovements() {
  return useTable<BottleMovement>("bottle_movements", "bottle_movements", {
    orderBy: "created_at",
    limit: 500,
  });
}

export type Supplier = {
  id: string;
  name: string;
  contact: string | null;
  email: string | null;
  address: string | null;
  balance: number;
  created_at: string;
};

export type Purchase = {
  id: string;
  supplier_id: string;
  reference: string;
  total_amount: number;
  amount_paid: number;
  status: string;
  purchase_date: string;
  created_at: string;
};

export type Quotation = {
  id: string;
  number: string;
  customer_name: string;
  customer_phone: string | null;
  items_summary: string;
  total_amount: number;
  valid_until: string;
  status: "draft" | "sent" | "accepted" | "expired" | "invoiced";
  notes: string | null;
  created_at: string;
};

export type Shift = {
  id: string;
  user_id: string | null;
  staff_name: string;
  shift_type: "morning" | "afternoon" | "evening" | "night" | "full_day";
  opening_float: number;
  closing_cash: number;
  expected_cash: number;
  status: "open" | "closed";
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

export function useSuppliers() {
  return useTable<Supplier>("suppliers", "suppliers", { orderBy: "name", ascending: true });
}

export function usePurchases() {
  return useTable<Purchase>("purchases", "purchases", { orderBy: "purchase_date" });
}

export function useQuotations() {
  return useTable<Quotation>("quotations", "quotations", { orderBy: "created_at" });
}

export function useShifts() {
  return useTable<Shift>("shifts", "shifts", { orderBy: "started_at" });
}

export function useStaff() {
  return useTable<AccountUser>("staff", "users", { orderBy: "created_at", ascending: true });
}

export function useBusinessProfile() {
  return useTable<Business>("business", "business");
}

export function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

export function isThisMonth(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}
