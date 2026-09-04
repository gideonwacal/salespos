import { currencyByCode, getBusiness } from "@/lib/demo";

/**
 * Format an amount in a given currency, to that currency's own precision.
 *
 * Shillings are whole; dollars, euros and pounds are not. Rounding everything
 * to whole units — which this used to do — turned $12.50 into $13.
 */
export function moneyIn(
  value: number | null | undefined,
  code: string,
  symbolOverride?: string,
) {
  const currency = currencyByCode(code);
  const symbol = symbolOverride || currency.symbol;
  return `${symbol} ${Number(value ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  })}`;
}

/** Money formatted in the currency the business selected during setup. */
export function money(value: number | null | undefined) {
  let code = "UGX";
  let symbol = "";
  try {
    const business = getBusiness();
    code = business.currency || "UGX";
    symbol = business.currency_symbol || "";
  } catch {
    /* SSR / not configured yet */
  }
  return moneyIn(value, code, symbol);
}

/** Round to the shop currency's own precision: whole shillings, but cents in USD. */
export function roundToCurrency(value: number) {
  const factor = 10 ** activeCurrency().decimals;
  return Math.round(Number(value ?? 0) * factor) / factor;
}

/** How many decimal places the shop's currency is quoted to. */
export function activeCurrency() {
  try {
    const business = getBusiness();
    const currency = currencyByCode(business.currency);
    return {
      code: currency.code as string,
      symbol: business.currency_symbol || currency.symbol,
      decimals: currency.decimals,
    };
  } catch {
    return { code: "UGX", symbol: "UGX", decimals: 0 };
  }
}

/** Legacy alias kept so every screen keeps rendering the active currency. */
export const ugx = money;

export function num(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("en-US");
}


export function shortDate(value: string | Date) {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export const CATEGORIES = [
  "Soft Drinks",
  "Alcoholic Drinks",
  "Household Items",
  "General Merchandise",
] as const;

export const EXPENSE_CATEGORIES = [
  "Power/Electricity",
  "Transport & Freight",
  "Offloading/Handling",
  "Shop Rent",
  "Staff Wages",
  "Local Taxes",
  "Miscellaneous",
] as const;

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "mtn_momo", label: "MTN Mobile Money" },
  { value: "airtel_money", label: "Airtel Money" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "credit", label: "Credit / Tab" },
] as const;

export function paymentLabel(value: string) {
  return PAYMENT_METHODS.find((p) => p.value === value)?.label ?? value;
}

export const DEBT_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-muted text-foreground" },
  partially_paid: { label: "Partially paid", className: "bg-warning-soft text-warning-foreground" },
  overdue: { label: "Overdue", className: "bg-destructive text-destructive-foreground" },
  cleared: { label: "Cleared", className: "bg-success-soft text-success" },
};

/**
 * Tiered wholesale pricing: base price by sale type, minus the bulk discount
 * once the quantity reaches the product's bulk threshold.
 */
export function tieredPrice(
  p: {
    unit_selling_price: number;
    wholesale_price: number | null;
    bulk_min_qty: number;
    bulk_discount_percent: number;
  },
  saleType: "retail" | "wholesale",
  qty: number,
) {
  const base =
    saleType === "wholesale"
      ? Number(p.wholesale_price ?? p.unit_selling_price)
      : Number(p.unit_selling_price);
  const min = Number(p.bulk_min_qty ?? 0);
  const pct = Number(p.bulk_discount_percent ?? 0);
  if (min > 0 && pct > 0 && qty >= min) return roundToCurrency(base * (1 - pct / 100));
  return base;
}

/** Product name shown across the marketing site and the app chrome. */
export const APP = {
  name: "SalesPos",
  tagline: "POS, inventory & financial control for growing businesses",
};


