/**
 * Paying for a subscription, the way it is actually done here.
 *
 * Where the network can be charged directly, there is no page to visit and
 * nothing to type back: the shop gives a number, the telco puts a PIN prompt
 * on that handset, and the plan turns on the moment it is approved. Where it
 * cannot — a bank transfer, or a network whose API is not configured — the
 * older path remains: send the money, then report the reference.
 *
 * Three steps either way, so the shape of the thing does not change under
 * someone who has learnt it: choose, send, confirm.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Banknote,
  Check,
  Copy,
  CreditCard,
  Info,
  Landmark,
  Loader2,
  Smartphone,
} from "lucide-react";
import { planById, type PlanId } from "@/lib/demo";
import {
  checkMobileMoneyCharge,
  startMobileMoneyCharge,
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

/** How often to ask the telco, and for how long before we stop watching. */
const POLL_MS = 4000;
const POLL_LIMIT_MS = 3 * 60 * 1000;

const digitsIn = (value: string) => value.replace(/\D/g, "").length;

function channelIcon(channel: PaymentChannel) {
  if (channel.kind === "bank") return Landmark;
  if (channel.kind === "card") return CreditCard;
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
  /** The charge we are watching, once a prompt has been sent to a phone. */
  const [waiting, setWaiting] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  const channels = useMemo(() => info?.channels ?? [], [info]);
  const onSubmittedRef = useRef(onSubmitted);
  onSubmittedRef.current = onSubmitted;

  // Reset when a different plan is opened — and only then. Keying this on the
  // channel list as well would wipe a half-typed number the moment the billing
  // details were refetched underneath the dialog.
  useEffect(() => {
    if (!plan) return;
    setStep("choose");
    setMonths(1);
    setPhone(defaultPhone);
    setReference("");
    setChannelId(null);
    setWaiting(null);
    setGaveUp(false);
  }, [plan, defaultPhone]);

  // One way to pay is not a choice; pre-select it, and the owner still sees
  // which rail it is on the next step.
  useEffect(() => {
    if (channels.length === 1) setChannelId((current) => current ?? channels[0].id);
  }, [channels]);

  /**
   * Watch a prompt that is sitting on somebody's phone.
   *
   * Stops on an answer, and stops asking after a few minutes — but giving up
   * watching is not the same as failing. The server keeps the record, so a PIN
   * entered late still lands; the shop just sees it on the payment list rather
   * than in this dialog.
   */
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    const startedAt = Date.now();

    const tick = async () => {
      if (!live) return;
      try {
        const { status, reason } = await checkMobileMoneyCharge(waiting);
        if (!live) return;

        if (status === "successful") {
          setWaiting(null);
          toast.success("Payment received — your plan is active.");
          onSubmittedRef.current();
          onOpenChange(false);
          return;
        }
        if (status === "failed") {
          setWaiting(null);
          toast.error(reason || "That payment was not completed.");
          setStep("send");
          return;
        }
      } catch {
        /* a blip between here and the telco; keep watching */
      }

      if (!live) return;
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        setWaiting(null);
        setGaveUp(true);
        return;
      }
      timer = window.setTimeout(tick, POLL_MS);
    };

    let timer = window.setTimeout(tick, POLL_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [waiting, onOpenChange]);

  if (!plan) return null;

  const chosen = planById(plan);
  const monthly = info?.prices[plan] ?? chosen.price_ugx;
  const total = monthly * months;
  const channel = channels.find((c) => c.id === channelId) ?? null;
  /** True when the telco can be asked to charge this number directly. */
  const collects = channel?.kind === "collect";
  /** The send-money string for this exact payment, ready to dial. */
  const dial =
    channel?.ussd && channel.account
      ? channel.ussd
          .replace("{number}", channel.account.replace(/\s/g, ""))
          .replace("{amount}", String(total))
      : "";

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${what} copied`);
    } catch {
      /* clipboard blocked — it is on screen anyway */
    }
  };

  /** Ask the telco to prompt this phone, then watch for the PIN. */
  const charge = async () => {
    if (!channel) return;
    if (digitsIn(phone) < 9) {
      toast.error("Enter the phone number to charge.");
      return;
    }
    setBusy(true);
    setGaveUp(false);
    try {
      const started = await startMobileMoneyCharge({
        plan,
        months,
        network: channel.id,
        phone: phone.trim(),
      });
      setWaiting(started.reference);
      setStep("confirm");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reach the network.");
    } finally {
      setBusy(false);
    }
  };

  /** The older path: money already sent by hand, reference reported here. */
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
            {step !== "choose" && !waiting && (
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
              ? "Choose how long, and how to pay."
              : step === "send"
                ? collects
                  ? "Which phone should we charge?"
                  : "Send the money, then come back and confirm."
                : collects
                  ? "Approve the request on your phone."
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
        ) : step === "send" && channel && collects ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Phone to charge</Label>
              <Input
                inputMode="tel"
                placeholder="07XX XXX XXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Must be the {channel.label} line you will approve on, with enough on it for{" "}
                {moneyIn(total, "UGX")}.
              </p>
            </div>
            <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              {channel.instructions}
            </p>
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

            {/* Saves keying a ten-digit number and an amount into a USSD menu
                on a small keypad, which is where this goes wrong. The handset
                still shows every step and the PIN is still theirs to enter. */}
            {dial && (
              <a href={`tel:${encodeURIComponent(dial)}`} className="block">
                <Button type="button" className="w-full" size="lg">
                  <Smartphone className="size-4" /> Open my {channel.label} menu
                </Button>
              </a>
            )}
            {dial && (
              <p className="text-center text-xs text-muted-foreground">
                Opens the dialler with <span className="font-mono">{dial}</span> ready. Check the
                steps on your phone before entering your PIN.
              </p>
            )}

            {channel.note && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 p-3 text-xs">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                {channel.note}
              </p>
            )}
          </div>
        ) : channel && collects ? (
          <Waiting
            phone={phone}
            amount={moneyIn(total, "UGX")}
            network={channel.label}
            watching={!!waiting}
            gaveUp={gaveUp}
          />
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
              {waiting ? "Close and keep waiting" : "Cancel"}
            </Button>
            {step === "choose" && (
              <Button disabled={!channel} onClick={() => setStep("send")}>
                Continue
              </Button>
            )}
            {step === "send" &&
              (collects ? (
                <Button disabled={busy} onClick={charge}>
                  {busy ? "Sending request…" : "Send request to my phone"}
                </Button>
              ) : (
                <Button onClick={() => setStep("confirm")}>I have sent it</Button>
              ))}
            {step === "confirm" &&
              (collects ? (
                gaveUp ? (
                  <Button onClick={charge} disabled={busy}>
                    Try again
                  </Button>
                ) : null
              ) : (
                <Button onClick={submit} disabled={busy}>
                  {busy ? "Submitting…" : "Submit payment"}
                </Button>
              ))}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The screen while a PIN prompt is sitting on somebody's handset. */
function Waiting({
  phone,
  amount,
  network,
  watching,
  gaveUp,
}: {
  phone: string;
  amount: string;
  network: string;
  watching: boolean;
  gaveUp: boolean;
}) {
  if (gaveUp) {
    return (
      <div className="space-y-2 rounded-lg border border-warning/50 bg-warning-soft/40 p-4 text-sm">
        <p className="font-semibold">Still nothing from {network}.</p>
        <p className="text-muted-foreground">
          The request may have timed out on the phone. If you did approve it, leave this — the
          payment still lands and your plan turns on by itself. Otherwise try again.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-4 text-center">
      <Loader2 className={cn("mx-auto size-6 text-primary", watching && "animate-spin")} />
      <p className="text-sm font-semibold">Check your phone</p>
      <p className="text-sm text-muted-foreground">
        {network} has sent a request for <span className="font-semibold">{amount}</span> to{" "}
        <span className="font-semibold">{phone}</span>. Enter your PIN to approve it.
      </p>
      <p className="text-xs text-muted-foreground">
        This page turns your plan on the moment it goes through. You can close it — the payment
        still counts.
      </p>
    </div>
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
 * Say what is actually wrong, to the one person who can do something about it,
 * rather than asking them to try again later — nothing changes until somebody
 * sets the credentials.
 */
function NothingConfigured() {
  return (
    <div className="space-y-2 rounded-lg border border-warning/50 bg-warning-soft/40 p-4 text-sm">
      <p className="font-semibold">No way to pay has been set up yet.</p>
      <p className="text-muted-foreground">
        SalesPos has not been given mobile money credentials or an account to collect
        subscriptions on. Whoever runs this SalesPos needs to set{" "}
        <span className="font-mono text-xs">MTN_MOMO_*</span> or{" "}
        <span className="font-mono text-xs">AIRTEL_*</span> on the server — or a number to send
        to — and then reload this page.
      </p>
    </div>
  );
}
