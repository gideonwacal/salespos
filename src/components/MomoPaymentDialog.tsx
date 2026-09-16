import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { planById, type PlanId } from "@/lib/demo";
import { submitSubscriptionPayment, type BillingInfo } from "@/lib/api";
import { moneyIn } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MONTHS = [1, 3, 6, 12];

/**
 * Pay a subscription by sending MTN Mobile Money to the owner of SalesPos.
 *
 * There is no merchant API behind this: the shop sends the money from its own
 * phone and reports the transaction ID, and the plan activates once that ID is
 * matched against the MTN statement and approved in the Django admin.
 */
export function MomoPaymentDialog({
  plan,
  info,
  defaultPhone,
  onOpenChange,
  onSubmitted,
}: {
  /** The plan being paid for; the dialog is open while this is set. */
  plan: PlanId | null;
  info: BillingInfo | undefined;
  defaultPhone: string;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
}) {
  const [months, setMonths] = useState(1);
  const [phone, setPhone] = useState(defaultPhone);
  const [transactionId, setTransactionId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!plan) return;
    setMonths(1);
    setPhone(defaultPhone);
    setTransactionId("");
  }, [plan, defaultPhone]);

  if (!plan) return null;
  const chosen = planById(plan);
  const monthly = info?.prices[plan] ?? chosen.price_ugx;
  const total = moneyIn(monthly * months, "UGX");
  const ready = !!info?.number;

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(info?.number ?? "");
      toast.success("Number copied");
    } catch {
      /* clipboard blocked — the number is on screen anyway */
    }
  };

  const submit = async () => {
    if (!phone.trim() || !transactionId.trim()) {
      toast.error("Enter the phone you paid from and the transaction ID.");
      return;
    }
    setBusy(true);
    try {
      await submitSubscriptionPayment({
        plan,
        months,
        payer_phone: phone.trim(),
        transaction_id: transactionId.trim(),
      });
      toast.success("Payment received — we'll activate your plan once it's confirmed.");
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay for {chosen.name} with MTN MoMo</DialogTitle>
          <DialogDescription>
            Send the money, then tell us the transaction ID so we can match it.
          </DialogDescription>
        </DialogHeader>

        {!ready ? (
          <p className="text-sm text-muted-foreground">
            Mobile money payments aren't set up yet. Please try again shortly.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>How long</Label>
              <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m} month{m === 1 ? "" : "s"} — {moneyIn(monthly * m, "UGX")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-semibold">1. Send {total}</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-extrabold tracking-wide">{info.number}</span>
                <Button type="button" size="sm" variant="ghost" onClick={copyNumber}>
                  <Copy className="size-4" />
                </Button>
              </div>
              {info.name && (
                <p className="text-muted-foreground">
                  MTN will show the name{" "}
                  <span className="font-medium text-foreground">{info.name}</span> — check it before
                  entering your PIN.
                </p>
              )}
              <p className="text-muted-foreground">
                Dial *165#, choose Send Money, or use the MoMo app.
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold">2. Tell us about the payment</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Phone you paid from</Label>
                  <Input
                    inputMode="tel"
                    placeholder="07XX XXX XXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Transaction ID</Label>
                  <Input
                    placeholder="From the MTN SMS"
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready || busy}>
            {busy ? "Submitting…" : "I've paid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
