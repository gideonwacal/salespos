/**
 * Sign-in / sign-up that works with or without the Django backend.
 *
 * Each call tries the API first. If the server simply isn't there — no process
 * running, no network — we fall back to the local store so the offline demo keeps
 * working. A server that *is* reachable and rejects the credentials surfaces its
 * error rather than silently falling back, otherwise a typo'd password would look
 * like a successful local login.
 *
 * On a successful server login we also mirror the session locally via
 * adoptServerSession, because the route guard and plan gating read the local
 * store synchronously.
 */

import * as api from "@/lib/api";
import type { MeResponse } from "@/lib/api";
import {
  adoptServerSession,
  signInLocal,
  signUpLocal,
  signOutLocal,
  type Business,
  type SessionUser,
} from "@/lib/demo";

/** What the server says about the WhatsApp number given at sign-up. */
export type WhatsAppLink = {
  number: string;
  pairing_code: string;
  /** A wa.me link that opens WhatsApp with the code already typed. This is
   *  the path that works: tapping it starts the conversation from the owner's
   *  own handset, which needs no approved template and opens Meta's 24-hour
   *  window. Empty when the server has no business number configured. */
  activation_link: string;
  /** Whether the cold template went out. A nudge for owners who never tap,
   *  not the way this is meant to happen. */
  welcome_sent: boolean;
};

/** fetch() throws a TypeError when it can't reach the host at all. */
function isUnreachable(error: unknown) {
  return error instanceof TypeError;
}

/** Server workspace -> the fields the local Business cache understands. */
export function businessFrom(workspace: api.ApiWorkspace): Partial<Business> {
  const pick = <T>(key: string, fallback: T): T => (workspace[key] as T | undefined) ?? fallback;
  return {
    name: workspace.name,
    tagline: pick("tagline", ""),
    industry: pick("industry", ""),
    address: pick("address", ""),
    city: pick("city", ""),
    country: pick("country", ""),
    phone: pick("phone", ""),
    email: pick("email", ""),
    tax_id: pick("tax_id", ""),
    currency: pick("currency", "UGX"),
    currency_symbol: pick("currency_symbol", "UGX"),
    vat_percent: Number(pick("vat_percent", 0)),
    receipt_footer: pick("receipt_footer", ""),
    logo_url: pick("logo_url", null),
    low_stock_alerts: pick("low_stock_alerts", true),
    expiry_alerts: pick("expiry_alerts", true),
    plan: pick("plan", "starter") as Business["plan"],
    access: pick("access", "standard") as Business["access"],
    trial_ends: pick("trial_ends", ""),
    subscribed: pick("subscribed", false),
    paid_until: pick("paid_until", null),
    referral_grace_until: pick("referral_grace_until", null),
    billing_enabled: pick("billing_enabled", true) as boolean,
    // The server owns this flag: someone who abandoned the wizard on sign-up
    // should land back in it when they sign in again, not on a blank dashboard.
    configured: pick("configured", true),
  };
}

/**
 * Sign in, and hand back what the server already told us.
 *
 * `me` comes back so the caller does not have to ask again: logging in already
 * costs two round trips, and on a sleeping free-tier host each one is seconds
 * rather than milliseconds. Absent when the sign-in fell back to the local
 * store, which has no server to have answered.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<{ user: SessionUser; me?: MeResponse }> {
  try {
    const me = await api.login(email, password);
    const user: SessionUser = {
      id: me.user.id,
      email: me.user.email,
      full_name: me.user.full_name,
      role: me.role ?? "manager",
      platform: !!me.platform,
    };

    const workspace = me.active_workspace;
    if (workspace) {
      adoptServerSession({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        user,
        business: businessFrom(workspace),
      });
    }
    return { user, me };
  } catch (error) {
    if (!isUnreachable(error)) throw error;
    return { user: signInLocal(email.trim(), password) };
  }
}

export async function signUp(input: {
  email: string;
  password: string;
  fullName: string;
  businessName: string;
  phone?: string;
  industry?: string;
  whatsappNumber?: string;
  referralCode?: string;
}): Promise<SessionUser & { whatsapp?: WhatsAppLink }> {
  try {
    const data = await api.register(input);
    const user: SessionUser = {
      id: data.user.id,
      email: data.user.email,
      full_name: data.user.full_name,
      role: "owner",
    };

    adoptServerSession({
      workspaceId: data.workspace.id,
      workspaceName: data.workspace.name,
      user,
      // A brand-new workspace still needs the setup wizard.
      business: { ...businessFrom(data.workspace), configured: false },
    });
    // Passed back so the sign-up screen can tell them to expect the WhatsApp
    // greeting, or show the pairing code if it could not be delivered.
    return { ...user, whatsapp: data.whatsapp ?? undefined };
  } catch (error) {
    if (!isUnreachable(error)) throw error;
    return signUpLocal(input);
  }
}

export function signOut() {
  api.logout();
  signOutLocal();
}
