/**
 * Where the money goes, visible on the page rather than behind a dialog.
 *
 * An owner wanting to know the deposit number should not have to start a
 * payment to find it. This lists every channel the server has been configured
 * with, each with a copy button, and says plainly when none has been.
 */

import { toast } from "sonner";
import { Copy, CreditCard, Smartphone, Wallet } from "lucide-react";
import type { BillingInfo } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function HowToPay({
  info,
  loading,
  isOwner,
}: {
  info: BillingInfo | undefined;
  loading: boolean;
  /** Only the owner may pay, and only the owner is served the details. */
  isOwner: boolean;
}) {
  if (!isOwner) return null;

  // Only the channels money is actually sent to belong in this list. A network
  // we can charge directly has no destination to copy — the prompt comes to
  // the shop's own phone — so it lives in the pay flow instead.
  const channels = (info?.channels ?? []).filter((c) => !!c.account);
  const prompts = (info?.channels ?? []).some((c) => c.kind === "collect");

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${what} copied`);
    } catch {
      /* clipboard blocked — it is on screen anyway */
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="size-4 text-brand" /> Where to send the money
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {prompts
            ? "Pick a package below and approve the request on your phone, or send money to one of these and confirm afterwards."
            : "Pick a package below to pay step by step, or send it directly to any of these and confirm afterwards."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading payment details…</p>
        ) : channels.length === 0 && prompts ? (
          <p className="text-sm text-muted-foreground">
            Nothing to send by hand. Pick a package below, give the phone number to charge, and
            approve the request with your PIN.
          </p>
        ) : channels.length === 0 ? (
          <div className="space-y-1 rounded-lg border border-warning/50 bg-warning-soft/40 p-3 text-sm">
            <p className="font-semibold">No payment details are set up yet.</p>
            <p className="text-muted-foreground">
              Nobody has given SalesPos a number or account to collect subscriptions on, so there
              is nothing here to send money to. Set{" "}
              <span className="font-mono text-xs">SUBSCRIPTION_MOMO_NUMBER</span> on the server —
              or the Airtel or bank equivalents — and it appears here.
            </p>
          </div>
        ) : (
          channels.map((c) => {
            const Icon = c.kind === "bank" ? CreditCard : Smartphone;
            return (
              <div
                key={c.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{c.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {c.account_label}
                    {c.holder ? ` · ${c.holder}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="tabular text-lg font-extrabold tracking-wide">{c.account}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    title={`Copy ${c.account_label.toLowerCase()}`}
                    onClick={() => copy(c.account, c.account_label)}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
