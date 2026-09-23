/**
 * Paying for a subscription, the way an app is expected to ask.
 *
 * Three steps rather than one long form: choose how long and how to pay, read
 * where the money goes, then say it is sent. The middle step exists because the
 * old dialog buried the number in a form — an owner looking for "where do I
 * deposit?" had to open a payment they had not decided to make yet, and if the
 * server had no number configured, the answer was a shrug.
 *
 * There is no card gateway behind SalesPos. A card pays the same way a bank
 * transfer does, and the dialog says so rather than implying a checkout that
 * does not exist.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Banknote,
  Check,
  Copy,
  CreditCard,
  Info,
  Landmark,
  Smartphone,
} from "lucide-react";
import { planById, type PlanId } from "@/lib/demo";
import {
  startCardCheckout,
  submitSubscriptionPayment,
  type BillingInfo,
  type PaymentChannel,
} from "@/lib/api";
import { moneyIn } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const MONTHS = [1, 3, 6, 12];

/** A longer commitment is the same price per month; say so rather than imply a discount. */
const MONTH_NOTE: Record<number, string> = {
  3: "one quarter",
  6: "half a year",
  12: "a full year",
};

function channelIcon(channel: PaymentChannel) {
  if (channel.kind === "card") return CreditCard;
  if (channel.kind === "bank") return Landmark;
  return Smartphone;
}

export function PaymentDialog({
  plan,
  info,
  loading,
  defaultPhone,
  onOpenChange,
  onSubmitted,
}: {
  /** The plan being paid for; the dialog is open while this is set. */
  plan: PlanId | null;
  info: BillingInfo | undefined;
  loading: boolean;
  defaultPhone: string;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
}) {
  const [step, setStep] = useState<"choose" | "send" | "confirm">("choose");
  const [months, setMonths] = useState(1);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [phone, setPhone] = useState(defaultPhone);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  const channels = useMemo(() => info?.channels ?? [], [info]);

  // Reset when a different plan is opened — and only then. Keying this on the
  // channel list as well would wipe a half-typed transaction ID the moment the
  // billing details were refetched underneath the dialog.
  useEffect(() => {
    if (!plan) return;
    setStep("choose");
    setMonths(1);
    setPhone(defaultPhone);
    setReference("");
    setChannelId(null);
  }, [plan, defaultPhone]);

  // One way to pay is not a choice; pre-select it, and the owner still sees
  // which rail it is on the next step.
  useEffect(() => {
    if (channels.length === 1) setChannelId((current) => current ?? channels[0].id);
  }, [channels]);

  if (!plan) return null;

  const chosen = planById(plan);
  const monthly = info?.prices[plan] ?? chosen.price_ugx;
  const total = monthly * months;
  const channel = channels.find((c) => c.id === channelId) ?? null;

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${what} copied`);
    } catch {
      /* clipboard blocked — it is on screen anyway */
    }
  };

  /**
   * Hand the shop over to Flutterwave.
   *
   * Nothing is reported back from here: the plan turns on when the gateway says
   * the money landed, so a shop that pays and closes the tab is still paid.
   */
  const goToCard = async () => {
    setBusy(true);
    try {
      const { url } = await startCardCheckout({ plan, months });
      window.location.href = url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the payment page.");
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!channel) return;
    if (!phone.trim() || !reference.trim()) {
      toast.error(`Enter your phone and the ${channel.reference_label.toLowerCase()}.`);
      return;
    }
    setBusy(true);
    try {
      await submitSubscriptionPayment({
        plan,
        months,
        payer_phone: phone.trim(),
        transaction_id: reference.trim(),
        network: channel.id,
      });
      toast.success("Payment received — your plan activates once it is confirmed.");
      onSubmitted();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit the payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step !== "choose" && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="-ml-2 size-7"
                onClick={() => setStep(step === "confirm" ? "send" : "choose")}
              >
                <ArrowLeft className="size-4" />
              </Button>
            )}
            {chosen.name} plan — {moneyIn(total, "UGX")}
          </DialogTitle>
          <DialogDescription>
            {step === "choose"
              ? "Choose how long, and how you want to pay."
              : step === "send"
                ? "Send the money, then come back and confirm."
                : "Tell us about the payment so we can match it."}
          </DialogDescription>
        </DialogHeader>

        <Steps step={step} />

        {loading && channels.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading payment details…
          </p>
        ) : channels.length === 0 ? (
          <NothingConfigured />
        ) : step === "choose" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>How long</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {MONTHS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMonths(m)}
                    className={cn(
                      "rounded-lg border p-2 text-center transition-colors",
                      months === m
                        ? "border-primary bg-primary/10 font-semibold text-primary"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <span className="block text-sm">
                      {m} month{m === 1 ? "" : "s"}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {moneyIn(monthly * m, "UGX")}
                    </span>
                  </button>
                ))}
              </div>
              {MONTH_NOTE[months] && (
                <p className="text-[11px] text-muted-foreground">
                  Paying for {MONTH_NOTE[months]} up front. The months are added on top of any
                  time you have left.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>How you want to pay</Label>
              {channels.map((c) => {
                const Icon = channelIcon(c);
                const picked = c.id === channelId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setChannelId(c.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                      picked
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-9 items-center justify-center rounded-lg",
                        picked ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{c.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {c.account ? `${c.account_label} ${c.account}` : c.account_label}
                      </span>
                    </span>
                    {picked && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>
        ) : step === "send" && channel ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Send exactly
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="text-2xl font-extrabold">{moneyIn(total, "UGX")}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => copy(String(total), "Amount")}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>

              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {channel.account_label}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="text-2xl font-extrabold tracking-wide">{channel.account}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => copy(channel.account, channel.account_label)}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>

              {channel.holder && (
                <p className="mt-2 text-sm text-muted-foreground">
                  It should show the name{" "}
                  <span className="font-semibold text-foreground">{channel.holder}</span> — check
                  that before you approve it.
                </p>
              )}
              <p className="mt-2 text-sm text-muted-foreground">{channel.instructions}</p>
            </div>

            {channel.note && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 p-3 text-xs">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                {channel.note}
              </p>
            )}
          </div>
        ) : channel ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Phone we can reach you on</Label>
              <Input
                inputMode="tel"
                placeholder="07XX XXX XXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{channel.reference_label}</Label>
              <Input
                placeholder={channel.reference_hint}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Banknote className="mt-0.5 size-3.5 shrink-0" />
              Nothing changes until the money is matched against our statement. You will see
              &ldquo;Confirming&rdquo; on this page until then.
            </p>
          </div>
        ) : null}

        {channels.length > 0 && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {step === "choose" &&
              (channel?.kind === "card" ? (
                <Button disabled={busy} onClick={goToCard}>
                  {busy ? "Opening payment page…" : "Pay now"}
                </Button>
              ) : (
                <Button disabled={!channel} onClick={() => setStep("send")}>
                  Continue
                </Button>
              ))}
            {step === "send" && <Button onClick={() => setStep("confirm")}>I have sent it</Button>}
            {step === "confirm" && (
              <Button onClick={submit} disabled={busy}>
                {busy ? "Submitting…" : "Submit payment"}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Where the owner is in the three steps. */
function Steps({ step }: { step: "choose" | "send" | "confirm" }) {
  const order = ["choose", "send", "confirm"];
  const at = order.indexOf(step);
  const labels = ["Choose", "Send", "Confirm"];
  return (
    <div className="flex items-center gap-2">
      {labels.map((label, i) => (
        <div key={label} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
              i <= at ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {i < at ? <Check className="size-3" /> : i + 1}
          </span>
          <span
            className={cn(
              "text-[11px] font-medium",
              i <= at ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
          {i < labels.length - 1 && <span className="h-px flex-1 bg-border" />}
        </div>
      ))}
    </div>
  );
}

/**
 * No channel is configured on the server.
 *
 * This used to read "try again shortly", which is not true — nothing changes
 * until someone sets the details. Say what is actually wrong, to the one person
 * who can do something about it.
 */
function NothingConfigured() {
  return (
    <div className="space-y-2 rounded-lg border border-warning/50 bg-warning-soft/40 p-4 text-sm">
      <p className="font-semibold">No payment details have been set up yet.</p>
      <p className="text-muted-foreground">
        SalesPos has not been given a number or account to collect subscriptions on, so there is
        nothing to send money to. Whoever runs this SalesPos needs to set{" "}
        <span className="font-mono text-xs">SUBSCRIPTION_MOMO_NUMBER</span> (or the Airtel or bank
        equivalents) on the server, then reload this page.
      </p>
    </div>
  );
}
