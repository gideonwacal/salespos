/**
 * The console's own client for /api/console/*.
 *
 * Shares no code or storage with the shop app. Tokens live in sessionStorage
 * under their own keys, so closing the tab signs the platform owner out, and
 * the server checks is_superuser on every call regardless.
 */

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000/api").replace(
  /\/$/,
  "",
);

const ACCESS_KEY = "control-room-access";
const REFRESH_KEY = "control-room-refresh";

function read(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked: the session lasts until reload */
  }
}

export const isSignedIn = () => !!read(ACCESS_KEY);

export function signOut() {
  write(ACCESS_KEY, null);
  write(REFRESH_KEY, null);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function messageFrom(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.detail === "string") return obj.detail;
    for (const value of Object.values(obj)) {
      if (typeof value === "string") return value;
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  if (status === 429) return "Too many attempts. Wait a minute and try again.";
  return `Request failed (${status})`;
}

async function refresh() {
  const token = read(REFRESH_KEY);
  if (!token) return false;
  const response = await fetch(`${API_URL}/auth/refresh/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh: token }),
  });
  if (!response.ok) {
    signOut();
    return false;
  }
  const data = (await response.json()) as { access: string; refresh?: string };
  write(ACCESS_KEY, data.access);
  if (data.refresh) write(REFRESH_KEY, data.refresh);
  return true;
}

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  const token = read(ACCESS_KEY);
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store" });
  if (response.status === 401 && retry && (await refresh())) {
    return call<T>(path, init, false);
  }
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    if (response.status === 401) signOut();
    throw new ApiError(messageFrom(payload, response.status), response.status);
  }
  return payload as T;
}

export type Me = { user: { id: string; email: string; full_name: string; is_superuser: boolean } };

export const fetchMe = () => call<Me>("/auth/me/");

/** Sign in, then refuse to keep the session unless it is the platform owner. */
export async function signIn(email: string, password: string) {
  const response = await fetch(`${API_URL}/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(messageFrom(payload, response.status), response.status);
  write(ACCESS_KEY, payload.access);
  write(REFRESH_KEY, payload.refresh);

  const me = await fetchMe();
  if (!me.user.is_superuser) {
    signOut();
    throw new ApiError("That account is not the platform owner.", 403);
  }
  return me;
}

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export type BusinessState = "trial" | "paying" | "expired" | "free" | "suspended";
export type Access = "standard" | "free" | "suspended";
export type PaymentStatus = "pending" | "approved" | "rejected";

export type ActivityEntry = {
  id: string;
  created_at: string;
  action: string;
  target: string;
  method: string;
  path: string;
  ip: string | null;
  by_platform: boolean;
  user: string | null;
  user_id: string | null;
  workspace: string | null;
  workspace_id: string | null;
};

export type Payment = {
  id: string;
  workspace: string;
  workspace_id: string;
  submitted_by: string | null;
  plan: string;
  months: number;
  amount: string;
  currency: string;
  payer_phone: string;
  transaction_id: string;
  status: PaymentStatus;
  note: string;
  reviewed_at: string | null;
  created_at: string;
};

export type Overview = {
  businesses: number;
  states: Record<BusinessState, number>;
  users: number;
  active_users_7d: number;
  signups_30d: number;
  pending_payments: number;
  revenue_total: string;
  revenue_month: string;
  activity_24h: number;
  recent_activity: ActivityEntry[];
};

export type BusinessRow = {
  id: string;
  name: string;
  industry: string;
  city: string;
  phone: string;
  owner: string | null;
  plan: string;
  access: Access;
  state: BusinessState;
  trial_ends: string | null;
  paid_until: string | null;
  members: number;
  last_activity: string | null;
  created_at: string;
};

export type BusinessDetail = BusinessRow & {
  tagline: string;
  address: string;
  country: string;
  email: string;
  currency: string;
  access_note: string;
  subscribed: boolean;
  configured: boolean;
  stats: { sales: number; sales_total: string; sales_30d: number; products: number };
  members: {
    id: string;
    user_id: string;
    email: string;
    full_name: string;
    phone: string;
    role: string;
    active: boolean;
    user_active: boolean;
    last_login: string | null;
  }[];
  payments: Payment[];
  activity: ActivityEntry[];
};

export type UserRow = {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  is_active: boolean;
  is_superuser: boolean;
  last_login: string | null;
  last_activity: string | null;
  created_at: string;
  businesses: { id: string; name: string; role: string; active: boolean }[];
};

export type BusinessPatch = Partial<{
  access: Access;
  access_note: string;
  plan: string;
  trial_ends: string;
  paid_until: string | null;
  subscribed: boolean;
}>;

/* ------------------------------------------------------------------ */
/* endpoints                                                           */
/* ------------------------------------------------------------------ */

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const api = {
  overview: () => call<Overview>("/console/overview/"),
  businesses: (params: { search?: string; state?: string } = {}) =>
    call<BusinessRow[]>(`/console/businesses/${qs(params)}`),
  business: (id: string) => call<BusinessDetail>(`/console/businesses/${id}/`),
  updateBusiness: (id: string, patch: BusinessPatch) =>
    call<BusinessDetail>(`/console/businesses/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  users: (params: { search?: string } = {}) => call<UserRow[]>(`/console/users/${qs(params)}`),
  setUserActive: (id: string, is_active: boolean) =>
    call<{ id: string; is_active: boolean }>(`/console/users/${id}/`, {
      method: "PATCH",
      body: JSON.stringify({ is_active }),
    }),
  payments: (params: { status?: string } = {}) =>
    call<Payment[]>(`/console/payments/${qs(params)}`),
  decidePayment: (id: string, decision: "approve" | "reject", note = "") =>
    call<Payment>(`/console/payments/${id}/${decision}/`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  activity: (params: {
    workspace?: string;
    user?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => call<{ results: ActivityEntry[]; has_more: boolean }>(`/console/activity/${qs(params)}`),
};
