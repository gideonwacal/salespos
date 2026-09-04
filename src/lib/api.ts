/**
 * Django API client.
 *
 * Holds the JWT pair and the active workspace id, refreshes the access token
 * once on a 401, and unwraps DRF's paginated list envelope so callers get a
 * plain array — the same shape dbSelect used to return.
 */

const ACCESS_KEY = "salespos-access";
const REFRESH_KEY = "salespos-refresh";
const WORKSPACE_KEY = "salespos-workspace";

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000/api").replace(
  /\/$/,
  "",
);

export type Tokens = { access: string; refresh: string };

/* ------------------------------------------------------------------ */
/* token + workspace storage                                           */
/* ------------------------------------------------------------------ */

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode — stay signed in for this tab only */
  }
}

export const getAccessToken = () => read(ACCESS_KEY);
export const getRefreshToken = () => read(REFRESH_KEY);
export const getWorkspaceId = () => read(WORKSPACE_KEY);

export function setTokens(tokens: Tokens | null) {
  write(ACCESS_KEY, tokens?.access ?? null);
  write(REFRESH_KEY, tokens?.refresh ?? null);
}

export function setWorkspaceId(id: string | null) {
  write(WORKSPACE_KEY, id);
}

/** True when we hold a token, i.e. the app should talk to Django. */
export function isLive() {
  return !!getAccessToken();
}

/* ------------------------------------------------------------------ */
/* request plumbing                                                    */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(messageFrom(detail) || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** DRF returns errors as {field: [msg]} or {detail: msg}; surface something readable. */
function messageFrom(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const obj = detail as Record<string, unknown>;
    if (typeof obj.detail === "string") return obj.detail;
    for (const value of Object.values(obj)) {
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
      if (typeof value === "string") return value;
    }
  }
  return "";
}

async function refreshAccessToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;

  const response = await fetch(`${API_URL}/auth/refresh/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!response.ok) {
    setTokens(null);
    return false;
  }

  const data = (await response.json()) as { access: string; refresh?: string };
  setTokens({ access: data.access, refresh: data.refresh ?? refresh });
  return true;
}

export async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean; retry?: boolean } = {},
): Promise<T> {
  const { auth = true, retry = true, ...rest } = init;

  const headers = new Headers(rest.headers);
  if (rest.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (auth) {
    const token = getAccessToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
    const workspace = getWorkspaceId();
    if (workspace) headers.set("x-workspace", workspace);
  }

  const response = await fetch(`${API_URL}${path}`, { ...rest, headers });

  // One retry after a token refresh; a second 401 means really signed out.
  if (response.status === 401 && auth && retry) {
    if (await refreshAccessToken()) {
      return request<T>(path, { ...init, retry: false });
    }
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) throw new ApiError(response.status, payload);
  return payload as T;
}

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */

export type ApiUser = {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
};

export type ApiWorkspace = Record<string, unknown> & { id: string; name: string };

export async function login(email: string, password: string) {
  const tokens = await request<Tokens>("/auth/login/", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  setTokens(tokens);

  // Pick up the default workspace so subsequent calls are scoped.
  const me = await fetchMe();
  if (me.active_workspace) setWorkspaceId(me.active_workspace.id);
  return me;
}

export async function register(input: {
  email: string;
  password: string;
  fullName: string;
  businessName: string;
  phone?: string;
  industry?: string;
}) {
  const data = await request<{
    access: string;
    refresh: string;
    user: ApiUser;
    workspace: ApiWorkspace;
    role: string;
  }>("/auth/register/", {
    method: "POST",
    auth: false,
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      full_name: input.fullName,
      phone: input.phone ?? "",
      business_name: input.businessName,
      industry: input.industry ?? "",
    }),
  });

  setTokens({ access: data.access, refresh: data.refresh });
  setWorkspaceId(data.workspace.id);
  return data;
}

export type MeResponse = {
  user: ApiUser;
  workspaces: ApiWorkspace[];
  active_workspace: ApiWorkspace | null;
  role: "owner" | "manager" | null;
};

export function fetchMe() {
  return request<MeResponse>("/auth/me/");
}

export function logout() {
  setTokens(null);
  setWorkspaceId(null);
}

/* ------------------------------------------------------------------ */
/* table CRUD                                                          */
/* ------------------------------------------------------------------ */

/** Frontend table name -> REST collection. Tables absent here have no backend yet. */
export const ENDPOINTS: Record<string, string> = {
  products: "products",
  stock_transactions: "stock-transactions",
  damage_reports: "damage-reports",
  sales: "sales",
  sale_items: "sale-items",
  expenses: "expenses",
  users: "members",
  business: "workspaces",
  // Wholesale modules the Growth plan bills for. Local storage until now,
  // which meant a paying shop lost its debtor book on a cleared browser.
  customers: "customers",
  debts: "debts",
  debt_payments: "debt-payments",
  bottle_movements: "bottle-movements",
  suppliers: "suppliers",
  purchases: "purchases",
  quotations: "quotations",
  shifts: "shifts",
};

export function hasEndpoint(table: string) {
  return table in ENDPOINTS;
}

type Paginated<T> = { results?: T[]; count?: number };

export async function selectTable<T>(table: string, limit?: number): Promise<T[]> {
  const endpoint = ENDPOINTS[table];
  if (!endpoint) return [];
  const query = limit ? `?limit=${limit}` : "";
  const data = await request<Paginated<T> | T[]>(`/${endpoint}/${query}`);
  if (Array.isArray(data)) return data;
  return data.results ?? [];
}

export async function insertTable<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
): Promise<Record<string, unknown>[]> {
  const endpoint = ENDPOINTS[table];
  if (!endpoint) return [];
  const created: Record<string, unknown>[] = [];
  for (const row of rows) {
    created.push(
      await request<Record<string, unknown>>(`/${endpoint}/`, {
        method: "POST",
        body: JSON.stringify(row),
      }),
    );
  }
  return created;
}

export function updateTable(table: string, id: string, patch: Record<string, unknown>) {
  const endpoint = ENDPOINTS[table];
  if (!endpoint) return Promise.resolve();
  return request<void>(`/${endpoint}/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteTable(table: string, id: string) {
  const endpoint = ENDPOINTS[table];
  if (!endpoint) return Promise.resolve();
  return request<void>(`/${endpoint}/${id}/`, { method: "DELETE" });
}

/**
 * Correct a sale that was rung up wrong.
 *
 * Sends the basket as it should read; the server settles the difference against
 * stock. Open to cashiers — deleting a sale is not.
 */
export function amendSale(
  id: string,
  input: {
    items: { product_id: string; quantity: number; unit_price?: number }[];
    sale_type?: "retail" | "wholesale";
    payment_method?: string;
    customer_name?: string;
  },
) {
  return request<Record<string, unknown>>(`/sales/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** POST a whole basket. The server prices it and moves the stock atomically. */
export function checkout(input: {
  items: { product_id: string; quantity: number; unit_price?: number }[];
  sale_type?: "retail" | "wholesale";
  payment_method?: string;
  customer_name?: string;
}) {
  return request<Record<string, unknown>>("/sales/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
