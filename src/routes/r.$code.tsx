import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { trackReferralVisit } from "@/lib/api";

/** Where the code waits until the sign-up form is submitted. */
export const REFERRAL_STORAGE_KEY = "salespos.referral";

/**
 * Remember who sent this person, for the sign-up form to pick up.
 *
 * sessionStorage, not localStorage: a code should not still be attached to a
 * browser weeks later, crediting a referral to someone whose link was opened
 * once and forgotten.
 */
export function rememberReferral(code: string) {
  try {
    sessionStorage.setItem(REFERRAL_STORAGE_KEY, code.toUpperCase());
  } catch {
    // Private browsing can refuse storage. The visit is still counted; only
    // the attribution is lost, and that must not break the sign-up.
  }
}

export function takeReferral(): string {
  try {
    return sessionStorage.getItem(REFERRAL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function clearReferral() {
  try {
    sessionStorage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

export const Route = createFileRoute("/r/$code")({
  head: () => ({
    meta: [
      { title: "You're invited to SalesPos" },
      {
        name: "description",
        content:
          "Run your shop on SalesPos — sales, stock and profit in one place. Start free for 14 days.",
      },
    ],
  }),
  component: ReferralLanding,
});

function ReferralLanding() {
  const { code } = useParams({ from: "/r/$code" });
  const navigate = useNavigate();
  const [from, setFrom] = useState<string | null>(null);
  // Effects run twice in React's development strict mode; without this the
  // same open is counted twice every time.
  const counted = useRef(false);

  useEffect(() => {
    if (counted.current) return;
    counted.current = true;

    rememberReferral(code);
    let cancelled = false;

    (async () => {
      const result = await trackReferralVisit(code);
      if (!cancelled) setFrom(result.business);
      // Held briefly so the invitation is actually seen; a redirect that fires
      // instantly just looks like a broken link.
      setTimeout(() => {
        if (!cancelled) navigate({ to: "/auth", replace: true });
      }, 1400);
    })();

    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          SalesPos
        </p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">
          {from ? `${from} invited you` : "You're invited"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sales, stock and profit in one place. Free for your first 14 days.
        </p>
        <p className="mt-6 text-xs text-muted-foreground">Taking you to sign up…</p>
      </div>
    </main>
  );
}
