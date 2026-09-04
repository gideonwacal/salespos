/**
 * SalesPos local data engine.
 *
 * The whole app talks to this module instead of a backend, so the product can
 * be demoed and sold before any server exists. Every read/write goes through
 * dbSelect / dbInsert / dbUpdate / dbDelete — swap the bodies of those four
 * functions for HTTP calls when you plug in your own backend.
 *
 * Storage:
 *  - live workspace data  -> localStorage  (persists across sessions)
 *  - demo sandbox data    -> sessionStorage (wiped on logout / tab close)
 *
 * NOTE: passwords are stored locally for the offline prototype only. Move
 * authentication server-side when you connect a real backend.
 */

const DEMO_FLAG = "salespos-demo";
const DEMO_STORE = "salespos-demo-data";
const LIVE_STORE = "salespos-data";
const SESSION_KEY = "salespos-session";
const WS_INDEX = "salespos-workspaces";
const WS_ACTIVE = "salespos-active-ws";

export type Tables = Record<string, Record<string, unknown>[]>;

export type AppRole = "owner" | "manager";

export type Business = {
  id: string;
  name: string;
  tagline: string;
  industry: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  tax_id: string;
  currency: string;
  currency_symbol: string;
  vat_percent: number;
  receipt_footer: string;
  logo_url: string | null;
  low_stock_alerts: boolean;
  expiry_alerts: boolean;
  plan: PlanId;
  trial_ends: string;
  subscribed: boolean;
  paid_until: string | null;
  configured: boolean;
};

export type AccountUser = {
  id: string;
  email: string;
  password: string;
  full_name: string;
  phone: string;
  role: AppRole;
  active: boolean;
  created_at: string;
};

export type PlanId = "starter" | "growth" | "enterprise";

export type ModuleId =
  | "pos"
  | "inventory"
  | "stock"
  | "expenses"
  | "reports"
  | "debtors"
  | "quotations"
  | "shifts"
  | "accounting"
  | "staff";

export const PLANS: {
  id: PlanId;
  name: string;
  price: number;
  seats: number;
  blurb: string;
  features: string[];
  modules: ModuleId[];
}[] = [
  {
    id: "starter",
    name: "Starter",
    price: 19,
    seats: 2,
    blurb: "One counter, one owner. Everything you need to start selling.",
    features: ["POS & receipts", "Inventory master grid", "Expense tracking", "2 user seats"],
    modules: ["pos", "inventory", "stock", "expenses", "reports", "staff"],
  },
  {
    id: "growth",
    name: "Growth",
    price: 49,
    seats: 8,
    blurb: "Busy shops with a team, credit customers and bottle deposits.",
    features: [
      "Everything in Starter",
      "Credit & debtor management",
      "Bottle / container deposits",
      "Bulk & tiered pricing",
      "Quotations & invoices",
      "Shift management",
      "8 user seats",
    ],
    modules: [
      "pos",
      "inventory",
      "stock",
      "expenses",
      "reports",
      "debtors",
      "quotations",
      "shifts",
      "staff",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 99,
    seats: 999,
    blurb: "Wholesalers running multiple counters with full financial control.",
    features: [
      "Everything in Growth",
      "Unlimited users",
      "Profit & loss reporting",
      "CSV import / export",
      "Accounting & other reports",
      "Priority support",
    ],
    modules: [
      "pos",
      "inventory",
      "stock",
      "expenses",
      "reports",
      "debtors",
      "quotations",
      "shifts",
      "accounting",
      "staff",
    ],
  },
];

export function planById(id: PlanId) {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

/** Package gating — a module is only visible when the active plan includes it. */
export function planHasModule(id: PlanId, mod: ModuleId) {
  return planById(id).modules.includes(mod);
}

/**
 * Currencies the shop can trade in.
 *
 * `decimals` is the part that matters: shillings are quoted whole, so showing
 * "UGX 1,500.00" is noise — but rounding $12.50 to $13 loses real money. Every
 * amount in the app is formatted through this.
 */
export const CURRENCIES = [
  { code: "UGX", symbol: "UGX", decimals: 0 },
  { code: "KES", symbol: "KSh", decimals: 0 },
  { code: "TZS", symbol: "TSh", decimals: 0 },
  { code: "NGN", symbol: "₦", decimals: 2 },
  { code: "RWF", symbol: "FRw", decimals: 0 },
  { code: "USD", symbol: "$", decimals: 2 },
  { code: "EUR", symbol: "€", decimals: 2 },
  { code: "GBP", symbol: "£", decimals: 2 },
  { code: "ZAR", symbol: "R", decimals: 2 },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

/** The currency record for a code, falling back to shillings. */
export function currencyByCode(code: string | null | undefined) {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

/* ------------------------------------------------------------------ */
/* reactivity                                                          */
/* ------------------------------------------------------------------ */

const listeners = new Set<() => void>();

export function subscribeStore(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => fn());
}

/* ------------------------------------------------------------------ */
/* mode                                                                */
/* ------------------------------------------------------------------ */

export function isDemo() {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(DEMO_FLAG) === "1";
}

export const DEMO_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "demo@salespos.app",
  full_name: "Demo Manager",
};

function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function iso(daysAgo: number, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}

function day(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* seeds                                                               */
/* ------------------------------------------------------------------ */

export function blankBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: uid(),
    name: "",
    tagline: "",
    industry: "General merchandise",
    address: "",
    city: "",
    country: "",
    phone: "",
    email: "",
    tax_id: "",
    currency: "UGX",
    currency_symbol: "UGX",
    vat_percent: 0,
    receipt_footer: "Thank you for your business!",
    logo_url: null,
    low_stock_alerts: true,
    expiry_alerts: true,
    plan: "starter",
    trial_ends: day(14),
    subscribed: false,
    paid_until: null,
    configured: false,
    ...overrides,
  };
}

function emptyTables(business: Business, users: AccountUser[]): Tables {
  return {
    business: [business as unknown as Record<string, unknown>],
    users: users as unknown as Record<string, unknown>[],
    products: [],
    customers: [],
    debts: [],
    debt_payments: [],
    bottle_movements: [],
    sales: [],
    sale_items: [],
    expenses: [],
    stock_transactions: [],
    damage_reports: [],
    suppliers: [],
    purchases: [],
    quotations: [],
    shifts: [],
  };
}

function demoSeed(): Tables {
  const p = (
    name: string,
    category: string,
    buy: number,
    sell: number,
    wholesale: number,
    stock: number,
    reorder: number,
    extra: Record<string, unknown> = {},
  ) => ({
    id: uid(),
    name,
    category,
    unit_buying_price: buy,
    unit_selling_price: sell,
    wholesale_price: wholesale,
    stock_quantity: stock,
    reorder_level: reorder,
    expiry_date: null,
    is_glass_bottle: false,
    bottles_per_unit: 1,
    bulk_min_qty: 0,
    bulk_discount_percent: 0,
    created_at: iso(40),
    ...extra,
  });

  const glass = {
    is_glass_bottle: true,
    bottles_per_unit: 24,
    bulk_min_qty: 6,
    bulk_discount_percent: 10,
  };

  const products = [
    p("Red Grape Wine 750ml", "Alcoholic Drinks", 9000, 12000, 11000, 48, 12, glass),
    p("Sparkling Wine 750ml", "Alcoholic Drinks", 8500, 11500, 10500, 9, 12, glass),
    p("House Gin 200ml (Crate)", "Alcoholic Drinks", 42000, 52000, 48000, 22, 8, glass),
    p("Premium Gin 500ml", "Alcoholic Drinks", 6000, 8500, 7800, 4, 10, glass),
    p("Cola Soda Crate (24)", "Soft Drinks", 26000, 32000, 29000, 35, 10, {
      ...glass,
      expiry_date: day(45),
    }),
    p("Energy Drink Crate", "Soft Drinks", 30000, 38000, 35000, 6, 10, {
      ...glass,
      expiry_date: day(12),
    }),
    p("Orange Soda 300ml Crate", "Soft Drinks", 24000, 30000, 27500, 40, 12, glass),
    p("Cooking Oil 5L", "Household Items", 32000, 39000, 36500, 18, 6, { expiry_date: day(120) }),
    p("Bar Soap (Carton)", "Household Items", 45000, 55000, 51000, 12, 5),
    p("Matchboxes (Pack)", "General Merchandise", 4000, 6000, 5200, 60, 20),
    p("Sugar 50kg Bale", "General Merchandise", 190000, 215000, 205000, 7, 4),
    p("Maize Flour 25kg Bag", "General Merchandise", 62000, 74000, 70000, 3, 6, {
      expiry_date: day(-3),
    }),
  ];

  const customers = [
    {
      id: uid(),
      name: "Bright Retail Shop",
      phone: "0771 234 567",
      notes: "Market stall",
      bottles_owed: 36,
      created_at: iso(30),
      updated_at: iso(2),
    },
    {
      id: uid(),
      name: "Sunset Bar & Lodge",
      phone: "0702 998 114",
      notes: "Weekly soda supply",
      bottles_owed: 72,
      created_at: iso(25),
      updated_at: iso(1),
    },
    {
      id: uid(),
      name: "Town Canteen",
      phone: "0758 441 220",
      notes: "",
      bottles_owed: 0,
      created_at: iso(18),
      updated_at: iso(4),
    },
  ];

  const debts = [
    {
      id: uid(),
      customer_id: customers[0].id,
      sale_id: null,
      items_summary: "3 x Cola Soda Crate, 2 x Orange Soda Crate",
      total_value: 156000,
      amount_paid: 56000,
      issue_date: day(-20),
      due_date: day(-4),
      status: "overdue",
      created_at: iso(20),
      updated_at: iso(6),
    },
    {
      id: uid(),
      customer_id: customers[1].id,
      sale_id: null,
      items_summary: "6 x House Gin Crate",
      total_value: 288000,
      amount_paid: 0,
      issue_date: day(-6),
      due_date: day(8),
      status: "pending",
      created_at: iso(6),
      updated_at: iso(6),
    },
    {
      id: uid(),
      customer_id: customers[2].id,
      sale_id: null,
      items_summary: "1 x Sugar 50kg Bale",
      total_value: 215000,
      amount_paid: 215000,
      issue_date: day(-14),
      due_date: day(-1),
      status: "cleared",
      created_at: iso(14),
      updated_at: iso(1),
    },
  ];

  const sales: Record<string, unknown>[] = [];
  const sale_items: Record<string, unknown>[] = [];
  for (let d = 6; d >= 0; d--) {
    const count = 2 + ((d * 3) % 3);
    for (let i = 0; i < count; i++) {
      const prod = products[(d + i) % products.length];
      const qty = 1 + ((d + i) % 4);
      const price = Number(prod.unit_selling_price);
      const id = uid();
      sales.push({
        id,
        sale_type: i % 3 === 0 ? "wholesale" : "retail",
        total_amount: price * qty,
        total_cost: Number(prod.unit_buying_price) * qty,
        payment_method: ["cash", "mtn_momo", "airtel_money", "cash"][i % 4],
        customer_name: i % 2 === 0 ? customers[i % customers.length].name : null,
        cashier_id: DEMO_USER.id,
        created_at: iso(d, 9 + i),
      });
      sale_items.push({
        id: uid(),
        sale_id: id,
        product_id: prod.id,
        quantity: qty,
        unit_price: price,
        unit_cost: Number(prod.unit_buying_price),
        subtotal: price * qty,
      });
    }
  }

  const expenses = [
    {
      id: uid(),
      category: "Power/Electricity",
      amount: 85000,
      description: "Prepaid units",
      vendor: "Power Co",
      expense_date: day(-3),
      payment_method: "cash",
      status: "approved",
      created_at: iso(3),
    },
    {
      id: uid(),
      category: "Transport & Freight",
      amount: 220000,
      description: "Lorry delivery",
      vendor: "City Transporters",
      expense_date: day(-5),
      payment_method: "mtn_momo",
      status: "approved",
      created_at: iso(5),
    },
    {
      id: uid(),
      category: "Shop Rent",
      amount: 400000,
      description: "Monthly rent",
      vendor: "Main Plaza",
      expense_date: day(-12),
      payment_method: "bank_transfer",
      status: "approved",
      created_at: iso(12),
    },
    {
      id: uid(),
      category: "Staff Wages",
      amount: 350000,
      description: "Two shop attendants",
      vendor: null,
      expense_date: day(-2),
      payment_method: "cash",
      status: "pending",
      created_at: iso(2),
    },
  ];

  const bottle_movements = [
    {
      id: uid(),
      customer_id: customers[0].id,
      sale_id: null,
      direction: "taken",
      quantity: 48,
      note: "2 crates soda",
      created_at: iso(9),
    },
    {
      id: uid(),
      customer_id: customers[0].id,
      sale_id: null,
      direction: "returned",
      quantity: 12,
      note: "Partial return",
      created_at: iso(3),
    },
    {
      id: uid(),
      customer_id: customers[1].id,
      sale_id: null,
      direction: "taken",
      quantity: 72,
      note: "3 crates",
      created_at: iso(5),
    },
  ];

  const suppliers = [
    {
      id: uid(),
      name: "Highway Distributors",
      contact: "0772 110 220",
      email: "sales@highway.co",
      address: "Industrial Area",
      balance: 450000,
      created_at: iso(35),
    },
    {
      id: uid(),
      name: "Lakeside Beverages",
      contact: "0700 554 331",
      email: "orders@lakeside.co",
      address: "Depot Road",
      balance: 0,
      created_at: iso(28),
    },
    {
      id: uid(),
      name: "Unity Wholesalers",
      contact: "0755 909 100",
      email: "info@unity.co",
      address: "Market Lane",
      balance: 180000,
      created_at: iso(20),
    },
  ];

  const purchases = [
    {
      id: uid(),
      supplier_id: suppliers[0].id,
      reference: "PO-1042",
      total_amount: 1250000,
      amount_paid: 800000,
      status: "partial",
      purchase_date: day(-8),
      created_at: iso(8),
    },
    {
      id: uid(),
      supplier_id: suppliers[1].id,
      reference: "PO-1043",
      total_amount: 640000,
      amount_paid: 640000,
      status: "paid",
      purchase_date: day(-4),
      created_at: iso(4),
    },
    {
      id: uid(),
      supplier_id: suppliers[2].id,
      reference: "PO-1044",
      total_amount: 380000,
      amount_paid: 0,
      status: "unpaid",
      purchase_date: day(-1),
      created_at: iso(1),
    },
  ];

  const quotations = [
    {
      id: uid(),
      number: "QT-1001",
      customer_name: customers[0].name,
      customer_phone: customers[0].phone,
      items_summary: "10 x Cola Soda Crate, 5 x Orange Soda Crate",
      total_amount: 470000,
      valid_until: day(7),
      status: "sent",
      notes: "Delivery included",
      created_at: iso(2),
    },
    {
      id: uid(),
      number: "QT-1002",
      customer_name: "Grace Hotel",
      customer_phone: "0781 220 004",
      items_summary: "20 x Cooking Oil 5L",
      total_amount: 780000,
      valid_until: day(3),
      status: "accepted",
      notes: "",
      created_at: iso(5),
    },
    {
      id: uid(),
      number: "QT-1003",
      customer_name: "Kalema Shop",
      customer_phone: "0704 118 992",
      items_summary: "4 x Sugar 50kg Bale",
      total_amount: 860000,
      valid_until: day(-2),
      status: "expired",
      notes: "",
      created_at: iso(12),
    },
  ];

  const shifts = [
    {
      id: uid(),
      user_id: DEMO_USER.id,
      staff_name: DEMO_USER.full_name,
      shift_type: "morning",
      opening_float: 100000,
      closing_cash: 640000,
      expected_cash: 655000,
      status: "closed",
      started_at: iso(1, 8),
      ended_at: iso(1, 15),
      created_at: iso(1, 8),
    },
    {
      id: uid(),
      user_id: DEMO_USER.id,
      staff_name: DEMO_USER.full_name,
      shift_type: "evening",
      opening_float: 80000,
      closing_cash: 0,
      expected_cash: 0,
      status: "open",
      started_at: iso(0, 14),
      ended_at: null,
      created_at: iso(0, 14),
    },
  ];

  const stock_transactions = products.slice(0, 5).map((prod, i) => ({
    id: uid(),
    product_id: prod.id,
    type: "stock_in",
    quantity: 20 + i * 5,
    notes: "Supplier delivery",
    expiry_date: prod.expiry_date ?? null,
    performed_by: DEMO_USER.id,
    created_at: iso(i + 1),
  }));

  const business = blankBusiness({
    name: "Demo Wholesalers Ltd",
    tagline: "Wholesale & retail general merchandise",
    address: "12 Market Street",
    city: "Central Town",

    country: "Uganda",
    phone: "0700 000 000",
    email: DEMO_USER.email,
    currency: "UGX",
    currency_symbol: "UGX",
    plan: "growth",
    configured: true,
  });

  const users: AccountUser[] = [
    {
      id: DEMO_USER.id,
      email: DEMO_USER.email,
      password: "demo",
      full_name: DEMO_USER.full_name,
      phone: "0700 000 000",
      role: "manager",
      active: true,
      created_at: iso(60),
    },
    {
      id: uid(),
      email: "owner@salespos.app",
      password: "demo",
      full_name: "Demo Owner",
      phone: "0700 111 222",
      role: "owner",
      active: true,
      created_at: iso(60),
    },
  ];

  return {
    ...emptyTables(business, users),
    products,
    customers,
    debts,
    bottle_movements,
    sales,
    sale_items,
    expenses,
    stock_transactions,
    suppliers,
    purchases,
    quotations,
    shifts,
  };
}

/* ------------------------------------------------------------------ */
/* persistence                                                         */
/* ------------------------------------------------------------------ */

export type WorkspaceRef = { id: string; name: string };

export function listWorkspaces(): WorkspaceRef[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(WS_INDEX) ?? "[]") as WorkspaceRef[];
  } catch {
    return [];
  }
}

function saveWorkspaces(list: WorkspaceRef[]) {
  localStorage.setItem(WS_INDEX, JSON.stringify(list));
}

export function activeWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(WS_ACTIVE);
}

function wsKey(id: string) {
  return `${LIVE_STORE}:${id}`;
}

/** Makes sure an active workspace exists, migrating any legacy single store. */
function ensureWorkspace(): string {
  const existing = activeWorkspaceId();
  if (existing && localStorage.getItem(wsKey(existing))) return existing;

  const list = listWorkspaces();
  const legacy = localStorage.getItem(LIVE_STORE);
  if (legacy && list.length === 0) {
    const id = uid();
    localStorage.setItem(wsKey(id), legacy);
    localStorage.removeItem(LIVE_STORE);
    saveWorkspaces([{ id, name: "My business" }]);
    localStorage.setItem(WS_ACTIVE, id);
    return id;
  }
  if (list.length > 0) {
    localStorage.setItem(WS_ACTIVE, list[0].id);
    return list[0].id;
  }
  return createWorkspace("");
}

/** Creates a brand-new, empty workspace for a client and makes it active. */
export function createWorkspace(name: string): string {
  const id = uid();
  localStorage.setItem(wsKey(id), JSON.stringify(emptyTables(blankBusiness({ name }), [])));
  saveWorkspaces([...listWorkspaces(), { id, name: name || "New business" }]);
  localStorage.setItem(WS_ACTIVE, id);
  return id;
}

export function switchWorkspace(id: string) {
  localStorage.setItem(WS_ACTIVE, id);
  emit();
}

function storeKey() {
  return isDemo() ? DEMO_STORE : wsKey(ensureWorkspace());
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  return isDemo() ? sessionStorage : localStorage;
}

function load(): Tables {
  const s = storage();
  if (!s) return {};
  const raw = s.getItem(storeKey());
  if (raw) {
    try {
      return JSON.parse(raw) as Tables;
    } catch {
      /* reseed below */
    }
  }
  const fresh = isDemo() ? demoSeed() : emptyTables(blankBusiness(), []);
  s.setItem(storeKey(), JSON.stringify(fresh));
  return fresh;
}

function save(tables: Tables) {
  storage()?.setItem(storeKey(), JSON.stringify(tables));
  emit();
}

/* ------------------------------------------------------------------ */
/* demo lifecycle                                                      */
/* ------------------------------------------------------------------ */

export function startDemo() {
  sessionStorage.setItem(DEMO_FLAG, "1");
  sessionStorage.setItem(DEMO_STORE, JSON.stringify(demoSeed()));
}

export function stopDemo() {
  sessionStorage.removeItem(DEMO_FLAG);
  sessionStorage.removeItem(DEMO_STORE);
  emit();
}

export function resetDemo() {
  save(demoSeed());
}

/* ------------------------------------------------------------------ */
/* CRUD — replace these four with API calls for a real backend         */
/* ------------------------------------------------------------------ */

export function dbSelect<T>(table: string): T[] {
  return (load()[table] ?? []) as T[];
}

export function dbInsert<T extends Record<string, unknown>>(table: string, rows: T[]): T[] {
  const tables = load();
  const stamped = rows.map((r) => ({
    id: uid(),
    created_at: new Date().toISOString(),
    ...r,
  })) as unknown as T[];
  tables[table] = [...(tables[table] ?? []), ...(stamped as Record<string, unknown>[])];
  applySideEffects(tables, table, stamped as unknown as Record<string, unknown>[]);
  save(tables);
  return stamped;
}

export function dbUpdate(table: string, id: string, patch: Record<string, unknown>) {
  const tables = load();
  tables[table] = (tables[table] ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r));
  save(tables);
}

export function dbDelete(table: string, id: string) {
  const tables = load();
  tables[table] = (tables[table] ?? []).filter((r) => r.id !== id);
  save(tables);
}

/* ------------------------------------------------------------------ */
/* business profile                                                    */
/* ------------------------------------------------------------------ */

export function getBusiness(): Business {
  const rows = dbSelect<Business>("business");
  return rows[0] ?? blankBusiness();
}

/**
 * Write server-owned business fields into the local mirror.
 *
 * Returns false and touches nothing when the values already match. That guard
 * matters: save() emits to the store, the auth provider is subscribed to the
 * store, and its refresh calls back here — without the equality check that is
 * an infinite loop.
 */
export function mergeServerBusiness(patch: Partial<Business>): boolean {
  const tables = load();
  const current = (tables.business?.[0] as unknown as Business) ?? blankBusiness();
  const next = { ...current, ...patch };
  if (JSON.stringify(next) === JSON.stringify(current)) return false;
  tables.business = [next as unknown as Record<string, unknown>];
  save(tables);
  return true;
}

export function saveBusiness(patch: Partial<Business>) {
  const tables = load();
  const current = (tables.business?.[0] as unknown as Business) ?? blankBusiness();
  tables.business = [{ ...current, ...patch } as unknown as Record<string, unknown>];
  save(tables);
}

/* ------------------------------------------------------------------ */
/* trial & subscription                                                */
/* ------------------------------------------------------------------ */

export type TrialStatus = {
  onTrial: boolean;
  subscribed: boolean;
  daysLeft: number;
  expired: boolean;
  /** true when the workspace must pay before using paid modules */
  locked: boolean;
};

export function trialStatus(business: Business): TrialStatus {
  const paidUntil = business.paid_until ? new Date(business.paid_until).getTime() : 0;
  const subscribed = !!business.subscribed && paidUntil > Date.now();
  const end = new Date(business.trial_ends).getTime();
  const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / 86400000));
  const expired = daysLeft <= 0;
  return {
    onTrial: !subscribed && !expired,
    subscribed,
    daysLeft,
    expired,
    locked: !subscribed && expired,
  };
}

/** Mock checkout — records a paid subscription for the given number of months. */
export function activateSubscription(plan: PlanId, months = 1) {
  const until = new Date();
  until.setMonth(until.getMonth() + months);
  saveBusiness({
    plan,
    subscribed: true,
    paid_until: until.toISOString().slice(0, 10),
  });
}

/* ------------------------------------------------------------------ */
/* local auth                                                          */
/* ------------------------------------------------------------------ */

export type SessionUser = { id: string; email: string; full_name: string; role: AppRole };

export function getSessionUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  if (isDemo()) {
    return {
      id: DEMO_USER.id,
      email: DEMO_USER.email,
      full_name: DEMO_USER.full_name,
      role: "manager",
    };
  }
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionUser;
    const user = dbSelect<AccountUser>("users").find((u) => u.id === parsed.id && u.active);
    if (!user) return null;
    return { id: user.id, email: user.email, full_name: user.full_name, role: user.role };
  } catch {
    return null;
  }
}

export function signInLocal(email: string, password: string): SessionUser {
  const wanted = email.trim().toLowerCase();
  // Look through every workspace on this device so any client can sign in.
  const workspaces = listWorkspaces();
  const candidates = workspaces.length > 0 ? workspaces.map((w) => w.id) : [];
  let found: { user: AccountUser; ws: string | null } | null = null;

  for (const id of candidates) {
    try {
      const tables = JSON.parse(localStorage.getItem(wsKey(id)) ?? "{}") as Tables;
      const user = ((tables.users ?? []) as unknown as AccountUser[]).find(
        (u) => u.email.toLowerCase() === wanted,
      );
      if (user) {
        found = { user, ws: id };
        break;
      }
    } catch {
      /* skip broken workspace */
    }
  }
  if (!found) {
    const user = dbSelect<AccountUser>("users").find((u) => u.email.toLowerCase() === wanted);
    if (user) found = { user, ws: null };
  }

  const user = found?.user;
  if (!user || user.password !== password) throw new Error("Wrong email or password");
  if (!user.active) throw new Error("This account has been deactivated");
  if (found?.ws) localStorage.setItem(WS_ACTIVE, found.ws);
  const session: SessionUser = {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  emit();
  return session;
}

/** Creates a brand-new workspace plus its owner account. */
export function signUpLocal(input: {
  email: string;
  password: string;
  fullName: string;
  businessName: string;
}): SessionUser {
  const wanted = input.email.trim().toLowerCase();
  const taken = listWorkspaces().some((w) => {
    try {
      const t = JSON.parse(localStorage.getItem(wsKey(w.id)) ?? "{}") as Tables;
      return ((t.users ?? []) as unknown as AccountUser[]).some(
        (u) => u.email.toLowerCase() === wanted,
      );
    } catch {
      return false;
    }
  });
  if (taken) throw new Error("An account with that email already exists");

  createWorkspace(input.businessName);
  const tables = load();
  const owner: AccountUser = {
    id: uid(),
    email: input.email.trim(),
    password: input.password,
    full_name: input.fullName || input.email.split("@")[0],
    phone: "",
    role: "owner",
    active: true,
    created_at: new Date().toISOString(),
  };
  tables.users = [owner as unknown as Record<string, unknown>];
  const current = (tables.business?.[0] as unknown as Business) ?? blankBusiness();
  tables.business = [
    { ...current, name: input.businessName || current.name } as unknown as Record<string, unknown>,
  ];
  save(tables);

  const session: SessionUser = {
    id: owner.id,
    email: owner.email,
    full_name: owner.full_name,
    role: owner.role,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  emit();
  return session;
}

export function signOutLocal() {
  localStorage.removeItem(SESSION_KEY);
  emit();
}

/**
 * Mirror a Django session into the local store.
 *
 * The route guard, plan gating and business profile all read from here
 * synchronously, so a server login has to leave the same footprint a local one
 * does — otherwise the guard sees no user and bounces straight back to /auth.
 * The local copy is a cache of the server's truth, never the other way round.
 */
export function adoptServerSession(input: {
  workspaceId: string;
  workspaceName: string;
  user: SessionUser;
  business?: Partial<Business>;
}) {
  if (typeof window === "undefined") return;
  const { workspaceId, workspaceName, user } = input;

  // Key the local mirror by the server's workspace id, so two accounts used on
  // the same device never read each other's cache.
  const key = wsKey(workspaceId);
  let tables: Tables;
  try {
    tables = JSON.parse(localStorage.getItem(key) ?? "null") as Tables;
  } catch {
    tables = null as unknown as Tables;
  }
  if (!tables || typeof tables !== "object") {
    tables = emptyTables(
      blankBusiness({ id: workspaceId, name: workspaceName, configured: true }),
      [],
    );
  }

  const current = (tables.business?.[0] as unknown as Business) ?? blankBusiness();
  tables.business = [
    {
      ...current,
      id: workspaceId,
      name: workspaceName || current.name,
      ...input.business,
      // An existing server workspace counts as set up, so the guard doesn't loop
      // every page back to /setup. A fresh sign-up passes false to keep the wizard.
      configured: input.business?.configured ?? true,
    } as unknown as Record<string, unknown>,
  ];

  // getSessionUser() resolves the session against this table, so it needs a row.
  const others = ((tables.users ?? []) as unknown as AccountUser[]).filter((u) => u.id !== user.id);
  tables.users = [
    ...others,
    {
      id: user.id,
      email: user.email,
      // Passwords live on the server now; nothing local to store.
      password: "",
      full_name: user.full_name,
      phone: "",
      role: user.role,
      active: true,
      created_at: new Date().toISOString(),
    },
  ] as unknown as Record<string, unknown>[];

  localStorage.setItem(key, JSON.stringify(tables));

  const index = listWorkspaces().filter((w) => w.id !== workspaceId);
  saveWorkspaces([...index, { id: workspaceId, name: workspaceName || "My business" }]);
  localStorage.setItem(WS_ACTIVE, workspaceId);
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  emit();
}

export function addTeamMember(input: {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  role: AppRole;
}) {
  const users = dbSelect<AccountUser>("users");
  if (users.some((u) => u.email.toLowerCase() === input.email.trim().toLowerCase())) {
    throw new Error("That email is already in use");
  }
  const seats = planById(getBusiness().plan).seats;
  if (users.filter((u) => u.active).length >= seats) {
    throw new Error(`Your plan allows ${seats} users. Upgrade to add more.`);
  }
  dbInsert("users", [
    {
      email: input.email.trim(),
      password: input.password,
      full_name: input.fullName,
      phone: input.phone ?? "",
      role: input.role,
      active: true,
    },
  ]);
}

/** Owner-only: switch a team member's role or activate/deactivate their login. */
export function updateTeamMember(
  id: string,
  patch: Partial<Pick<AccountUser, "role" | "active" | "full_name" | "phone" | "password">>,
) {
  dbUpdate("users", id, patch as Record<string, unknown>);
}

export function removeTeamMember(id: string) {
  dbDelete("users", id);
}

/** Resets the live workspace back to a fresh, empty install. */
export function wipeWorkspace() {
  localStorage.removeItem(LIVE_STORE);
  localStorage.removeItem(SESSION_KEY);
  emit();
}

/* ------------------------------------------------------------------ */
/* derived write rules (stand in for backend triggers)                 */
/* ------------------------------------------------------------------ */

function applySideEffects(tables: Tables, table: string, rows: Record<string, unknown>[]) {
  const bump = (productId: string, delta: number) => {
    tables.products = (tables.products ?? []).map((p) =>
      p.id === productId
        ? { ...p, stock_quantity: Math.max(0, Number(p.stock_quantity) + delta) }
        : p,
    );
  };

  for (const row of rows) {
    if (table === "sale_items") bump(String(row.product_id), -Number(row.quantity));
    if (table === "damage_reports") bump(String(row.product_id), -Number(row.quantity));
    if (table === "stock_transactions") {
      const type = String(row.type);
      const q = Number(row.quantity);
      bump(String(row.product_id), type === "stock_in" || type === "adjustment" ? q : -Math.abs(q));
      if (row.expiry_date && type === "stock_in") {
        tables.products = (tables.products ?? []).map((p) =>
          p.id === row.product_id ? { ...p, expiry_date: row.expiry_date } : p,
        );
      }
    }
    if (table === "bottle_movements") {
      tables.customers = (tables.customers ?? []).map((c) =>
        c.id === row.customer_id
          ? {
              ...c,
              bottles_owed: Math.max(
                0,
                Number(c.bottles_owed) +
                  (row.direction === "taken" ? Number(row.quantity) : -Number(row.quantity)),
              ),
            }
          : c,
      );
    }
    if (table === "debt_payments") {
      tables.debts = (tables.debts ?? []).map((d) => {
        if (d.id !== row.debt_id) return d;
        const paid = Number(d.amount_paid) + Number(row.amount);
        const total = Number(d.total_value);
        const overdue = String(d.due_date) < new Date().toISOString().slice(0, 10);
        return {
          ...d,
          amount_paid: paid,
          status:
            paid >= total
              ? "cleared"
              : overdue
                ? "overdue"
                : paid > 0
                  ? "partially_paid"
                  : "pending",
        };
      });
    }
  }
}
