/**
 * The single seam between the UI and its data.
 *
 * Everything in the app reads through selectRows and writes through the three
 * helpers below. Each one picks a backend per call:
 *
 *   - Django, when the user holds a token AND the table has an endpoint
 *   - the local demo store, otherwise
 *
 * That per-table check is what lets phase 1 ship: products/sales/stock/expenses
 * are live against Postgres while debtors, quotations and shifts keep running on
 * localStorage until their endpoints exist.
 */

import type { SaleLine } from "@/lib/data";
import {
  addTeamMember,
  dbInsert,
  dbSelect,
  dbUpdate,
  dbDelete,
  isDemo,
  planById,
  saveBusiness,
  updateTeamMember,
  type AppRole,
  type Business,
} from "@/lib/demo";
import {
  amendSale,
  checkout,
  deleteTable,
  hasEndpoint,
  insertTable,
  isLive,
  selectTable,
  updateTable,
} from "@/lib/api";

type Row = Record<string, unknown>;

/** True when this specific table should hit the API rather than localStorage. */
export function isServerTable(table: string) {
  // Demo mode always stays local: the sales pitch must work with no server.
  if (isDemo()) return false;
  return isLive() && hasEndpoint(table);
}

export async function selectRows<T>(table: string, limit?: number): Promise<T[]> {
  if (isServerTable(table)) return selectTable<T>(table, limit);
  const rows = dbSelect<T>(table);
  return limit ? rows.slice(0, limit) : rows;
}

export async function insertRows<T extends Row>(table: string, rows: T | T[]): Promise<Row[]> {
  const list = Array.isArray(rows) ? rows : [rows];
  if (isServerTable(table)) return insertTable(table, list);
  return dbInsert(table, list);
}

export async function updateRow(table: string, id: string, patch: Row) {
  if (isServerTable(table)) {
    await updateTable(table, id, patch);
    return;
  }
  dbUpdate(table, id, patch);
}

export async function deleteRow(table: string, id: string) {
  if (isServerTable(table)) {
    await deleteTable(table, id);
    return;
  }
  dbDelete(table, id);
}

/* ------------------------------------------------------------------ */
/* staff                                                               */
/* ------------------------------------------------------------------ */

export type StaffRow = {
  id: string;
  /** Present only on server rows: `id` is the membership, this is the person. */
  user_id?: string;
  email: string;
  full_name: string;
  phone: string;
  role: AppRole;
  active: boolean;
  created_at: string;
};

/** The id that identifies the *person*, so "is this me?" works on both backends. */
export function staffUserId(row: StaffRow) {
  return row.user_id ?? row.id;
}

/**
 * Create a real login for a teammate.
 *
 * On a live session this POSTs to /api/members/, which creates the User and the
 * owner-scoped Membership in one transaction — the person can then sign in on
 * their own device. The local store is only used when there's no server.
 */
export async function addStaff(input: {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  role: AppRole;
}): Promise<void> {
  if (!isServerTable("users")) {
    addTeamMember(input);
    return;
  }

  // The seat limit is a plan rule, not a server rule, so it is checked here for
  // both backends rather than duplicated in Django.
  const seats = planById(dbSelect<Business>("business")[0]?.plan ?? "starter").seats;
  const current = await selectTable<StaffRow>("users");
  if (current.filter((m) => m.active !== false).length >= seats) {
    throw new Error(`Your plan allows ${seats} users. Upgrade to add more.`);
  }

  await insertTable("users", [
    {
      email: input.email.trim().toLowerCase(),
      password: input.password,
      full_name: input.fullName,
      phone: input.phone ?? "",
      role: input.role,
    },
  ]);
}

/** Change a teammate's role or revoke their access. */
export async function updateStaff(
  id: string,
  patch: { role?: AppRole; active?: boolean },
): Promise<void> {
  if (isServerTable("users")) {
    await updateTable("users", id, patch);
    return;
  }
  updateTeamMember(id, patch);
}

/** Business columns the workspace endpoint accepts. `plan`/trial/billing are
 * server-owned, so the settings form must not push them back. */
const BUSINESS_FIELDS = [
  "name",
  "tagline",
  "industry",
  "address",
  "city",
  "country",
  "phone",
  "email",
  "tax_id",
  "currency",
  "currency_symbol",
  "vat_percent",
  "receipt_footer",
  "logo_url",
  "low_stock_alerts",
  "expiry_alerts",
  "configured",
] as const;

/**
 * Save the business profile from the setup wizard and the settings page.
 *
 * The local mirror is written either way, because the route guard reads
 * getBusiness() synchronously before any request could finish. On a live
 * session the same fields are PATCHed onto the workspace row, so the profile
 * survives a new device or a cleared browser.
 */
export async function saveBusinessProfile(patch: Partial<Business>) {
  saveBusiness(patch);
  if (!isServerTable("business")) return;

  const id = patch.id ?? (dbSelect<Business>("business")[0]?.id as string | undefined);
  if (!id) return;

  const body: Row = {};
  for (const field of BUSINESS_FIELDS) {
    if (patch[field] !== undefined) body[field] = patch[field];
  }
  if (Object.keys(body).length === 0) return;
  await updateTable("business", id, body);
}

/**
 * The lines of one sale, whichever backend holds them.
 *
 * The API nests them on the sale as {product, product_name, ...}; the local
 * store keeps a flat sale_items table keyed by sale_id. Callers should not have
 * to know which, so both are normalised to SaleLine here.
 */
export function saleLines(sale: { id: string; items?: unknown[] }): SaleLine[] {
  if (isServerTable("sales") && Array.isArray(sale.items)) {
    return (sale.items as Row[]).map((item) => ({
      product_id: String(item.product ?? item.product_id ?? ""),
      product_name: String(item.product_name ?? ""),
      quantity: Number(item.quantity ?? 0),
      unit_price: Number(item.unit_price ?? 0),
      unit_cost: Number(item.unit_cost ?? 0),
    }));
  }

  const products = dbSelect<Row>("products");
  return dbSelect<Row>("sale_items")
    .filter((line) => line.sale_id === sale.id)
    .map((line) => ({
      product_id: String(line.product_id ?? ""),
      product_name: String(
        products.find((p) => p.id === line.product_id)?.name ?? "Item",
      ),
      quantity: Number(line.quantity ?? 0),
      unit_price: Number(line.unit_price ?? 0),
      unit_cost: Number(line.unit_cost ?? 0),
    }));
}

/**
 * Correct a completed sale and move stock to match.
 *
 * On the server this is one transaction: the old lines come off, the new ones
 * go on, and the shelf is settled against the difference. Locally we do the
 * same three steps by hand — no transaction to honour, same result.
 */
export async function amendSaleRows(
  saleId: string,
  input: {
    sale_type: string;
    payment_method: string;
    customer_name: string | null;
    lines: CheckoutLine[];
  },
): Promise<void> {
  if (isServerTable("sales")) {
    await amendSale(saleId, {
      items: input.lines.map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
        unit_price: l.unit_price,
      })),
      sale_type: input.sale_type as "retail" | "wholesale",
      payment_method: input.payment_method,
      customer_name: input.customer_name ?? "",
    });
    return;
  }

  const oldLines = dbSelect<Row>("sale_items").filter((l) => l.sale_id === saleId);

  // Net movement per product, so a quantity that drops returns the balance and
  // one that rises takes more off.
  const delta = new Map<string, number>();
  for (const line of oldLines) {
    const id = String(line.product_id);
    delta.set(id, (delta.get(id) ?? 0) - Number(line.quantity ?? 0));
  }
  for (const line of input.lines) {
    delta.set(line.product_id, (delta.get(line.product_id) ?? 0) + line.quantity);
  }

  const products = dbSelect<Row>("products");
  for (const [productId, change] of delta) {
    if (change === 0) continue;
    const product = products.find((p) => p.id === productId);
    if (!product) continue;
    dbUpdate("products", productId, {
      stock_quantity: Math.max(0, Number(product.stock_quantity ?? 0) - change),
    });
  }

  for (const line of oldLines) dbDelete("sale_items", String(line.id));
  dbInsert(
    "sale_items",
    input.lines.map((l) => ({ ...l, sale_id: saleId })),
  );

  dbUpdate("sales", saleId, {
    sale_type: input.sale_type,
    payment_method: input.payment_method,
    customer_name: input.customer_name,
    total_amount: input.lines.reduce((a, l) => a + l.subtotal, 0),
    total_cost: input.lines.reduce((a, l) => a + l.unit_cost * l.quantity, 0),
  });
}

export type CheckoutLine = {
  product_id: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  subtotal: number;
};

/**
 * Complete a sale.
 *
 * The server takes the whole basket in one request so the sale, its lines, the
 * stock decrements and the ledger entries commit or fail together. Locally we
 * still write the two tables separately — same result, no transaction to honour.
 *
 * Returns the created sale row; callers need its id for credit and bottle records.
 */
export async function checkoutSale(input: {
  sale_type: string;
  total_amount: number;
  total_cost: number;
  payment_method: string;
  customer_name: string | null;
  cashier_id: string;
  lines: CheckoutLine[];
}): Promise<Row> {
  if (isServerTable("sales")) {
    return checkout({
      items: input.lines.map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
        // Send the price the cashier actually saw, so counter discounts stick.
        unit_price: l.unit_price,
      })),
      sale_type: input.sale_type as "retail" | "wholesale",
      payment_method: input.payment_method,
      // The server field is a blank-able string, never null.
      customer_name: input.customer_name ?? "",
    });
  }

  // dbInsert stamps id/created_at onto the row it returns.
  const [sale] = dbInsert<Row>("sales", [
    {
      sale_type: input.sale_type,
      total_amount: input.total_amount,
      total_cost: input.total_cost,
      payment_method: input.payment_method,
      customer_name: input.customer_name,
      cashier_id: input.cashier_id,
    },
  ]);

  dbInsert(
    "sale_items",
    input.lines.map((l) => ({ ...l, sale_id: sale.id as string })),
  );
  return sale;
}
