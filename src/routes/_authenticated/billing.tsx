import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Lightbulb, Minus, Smartphone } from "lucide-react";
import {
  PLANS,
  planById,
  planHasModule,
  trialStatus,
  activateSubscription,
  isDemo,
  mergeServerBusiness,
  type ModuleId,
  type PlanId,
} from "@/lib/demo";
import { fetchBillingInfo, fetchMe, listSubscriptionPayments } from "@/lib/api";
import { businessFrom } from "@/lib/auth";
import { isServerTable } from "@/lib/db";
import { PaymentDialog } from "@/components/PaymentDialog";
import { HowToPay } from "@/components/HowToPay";
import { PaymentWalkthrough } from "@/components/PaymentWalkthrough";
import { useAuth } from "@/hooks/useAuth";
import { useBusiness } from "@/hooks/useBusiness";
import { useStaff, useCustomers, useDebts, useQuotations } from "@/lib/data";
import { useIndustry } from "@/hooks/useIndustry";
import { recommendPlan } from "@/lib/planAdvice";
import { moneyIn, shortDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "Plan & Billing — SalesPos" },
      { name: "description", content: "Review your SalesPos subscription, seat usage and trial status, and switch plans at any time." },
      { property: "og:title", content: "Plan & Billing — SalesPos" },
      { property: "og:description", content: "Review your subscription, seat usage and trial status." },
    ],
  }),
  component: Billing,
});

const MODULES: [ModuleId, string][] = [
  ["pos", "POS terminal & receipts"],
  ["inventory", "Inventory master grid"],
  ["stock", "Stock movements & suppliers"],
  ["expenses", "Expense tracking"],
  ["reports", "Financial reports"],
  ["debtors", "Credit & debtor management"],
  ["quotations", "Quotations & invoices"],
  ["shifts", "Shift management"],
  ["accounting", "Accounting & other reports"],
  ["staff", "Users & roles"],
];

function Billing() {
  const business = useBusiness();
  const { data: staff = [] } = useStaff();
  const { data: customers = [] } = useCustomers();
  const { data: debts = [] } = useDebts();
  const { data: quotations = [] } = useQuotations();
  const industry = useIndustry();
  const current = planById(business.plan);
  const status = trialStatus(business);

  // The advice is worked out from what the shop is actually doing, so it
  // reads as an observation rather than an upsell.
  const advice = recommendPlan(business.plan, industry, {
    staffCount: staff.length,
    customerCount: customers.length,
    debtCount: debts.filter((d) => d.status !== "cleared").length,
    bottlesOutstanding: customers.reduce((a, c) => a + (c.bottles_owed ?? 0), 0),
    quotationCount: quotations.length,
  });
  const advised = planById(advice.recommended);

  const { isOwner } = useAuth();
  const queryClient = useQueryClient();
  const live = isServerTable("business");
  const [paying, setPaying] = useState<PlanId | null>(null);

  // The payment details are fetched for the owner on this page, not only while
  // the dialog is open: an owner asking "where do I deposit?" should be able to
  // read the number without first starting a payment. Still owner-only and
  // rate-limited on the server, so it is cached for a few minutes rather than
  // re-fetched on every glance.
  const { data: billingInfo, isLoading: billingLoading } = useQuery({
    queryKey: ["billing-info"],
    queryFn: fetchBillingInfo,
    enabled: live && isOwner,
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const { data: payments = [] } = useQuery({
    queryKey: ["subscription-payments"],
    enabled: live,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const rows = await listSubscriptionPayments();
      // Approval happens in the admin, not here, so pick up the plan it
      // activated whenever the payment list is looked at again.
      const me = await fetchMe();
      if (me.active_workspace) mergeServerBusiness(businessFrom(me.active_workspace));
      return rows;
    },
  });
  const pending = payments.filter((p) => p.status === "pending");

  const pay = (id: PlanId) => {
    // The demo is a sales pitch with no server behind it, so it still
    // activates instantly.
    if (isDemo()) {
      activateSubscription(id, 1);
      toast.success(`${planById(id).name} plan activated — thank you!`);
      return;
    }
    if (!live) {
      toast.error("Paying needs an online account. Connect to the internet and sign in again.");
      return;
    }
    setPaying(id);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Plan & billing</h1>
        <p className="text-sm text-muted-foreground">
          {status.onTrial
            ? `${staff.length} seat${staff.length === 1 ? "" : "s"} used (unlimited during trial)`
            : `${staff.length} of ${current.seats === 999 ? "unlimited" : current.seats} seats used`}{" "}
          ·{" "}
          {status.suspended
            ? "account suspended"
            : status.free
              ? "free access, no subscription needed"
              : status.subscribed
                ? `subscription active until ${shortDate(business.paid_until ?? "")}`
                : status.onTrial
                  ? `trial ends ${shortDate(business.trial_ends)} (${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"} left)`
                  : "trial ended"}
        </p>
      </div>

      {status.suspended && (
        <Card className="border-destructive shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
            <p className="font-medium">
              This business has been suspended. Contact SalesPos support to restore access.
            </p>
            <Badge className="border-0 bg-destructive text-destructive-foreground">Suspended</Badge>
          </CardContent>
        </Card>
      )}

      {status.free && (
        <Card className="border-success/50 shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
            <p className="font-medium">
              Your business has free access to the {current.name} plan. No subscription payment is
              needed.
            </p>
            <Badge className="border-0 bg-success text-success-foreground">Free access</Badge>
          </CardContent>
        </Card>
      )}

      {!status.subscribed && !status.free && !status.suspended && (
        <Card
          className={cn(
            "shadow-[var(--shadow-card)]",
            status.expired ? "border-destructive" : "border-warning",
          )}
        >
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
            <p className="font-medium">
              {status.expired
                ? "Your 14-day free trial has ended. Choose a package below to keep using SalesPos."
                : `You are on the free trial — ${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"} remaining. Every module and unlimited seats are open until ${shortDate(business.trial_ends)}; after that, what you can use depends on the package you choose.`}
            </p>
            <Badge
              className={cn(
                "border-0",
                status.expired
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-warning text-warning-foreground",
              )}
            >
              {status.expired ? "Payment required" : "Trial"}
            </Badge>
          </CardContent>
        </Card>
      )}


      {pending.map((p) => (
        <Card key={p.id} className="border-primary shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
            <p className="font-medium">
              We&apos;ve got your payment of {moneyIn(Number(p.amount), p.currency)} for{" "}
              {planById(p.plan as PlanId).name} ({p.transaction_id}). Your plan activates as soon
              as it&apos;s confirmed.
            </p>
            <Badge variant="outline" className="border-primary/40 text-primary">
              Confirming
            </Badge>
          </CardContent>
        </Card>
      ))}

      {/* High on the page on purpose: "where do I deposit?" was unanswerable
          without opening a payment first. */}
      {!status.free && !status.suspended && (
        <HowToPay info={billingInfo} loading={billingLoading} isOwner={isOwner} />
      )}

      {/* Shown to a shop that has not paid before — during the demo, on the
          trial, and after it runs out. A business that has been paying for
          months does not need to watch it again. */}
      {!status.free && !status.suspended && (isDemo() || !status.subscribed) && (
        <PaymentWalkthrough
          plan={advice.recommended}
          number={billingInfo?.number ?? "0760 417 357"}
          holder={billingInfo?.name}
        />
      )}

      <Card
        className={cn(
          "shadow-[var(--shadow-card)]",
          advice.isUpgrade ? "border-primary" : "border-success/50",
        )}
      >
        <CardContent className="space-y-2 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Lightbulb className="size-4 text-primary" />
            <p className="text-sm font-bold">
              {advice.isUpgrade
                ? `Suggested for ${business.name || "your shop"}: ${advised.name}`
                : `${advised.name} suits how you are trading`}
            </p>
            <Badge variant="outline" className="border-primary/40 text-primary">
              {industry.label}
            </Badge>
          </div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {advice.reasons.map((reason) => (
              <li key={reason} className="flex gap-2">
                <span aria-hidden="true">&bull;</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
          {advice.isUpgrade && (
            <Button size="sm" disabled={!isOwner || status.suspended || status.free} onClick={() => pay(advice.recommended)}>
              Move to {advised.name} &mdash; {moneyIn(advised.price_ugx, "UGX")}/month
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const active = plan.id === business.plan && status.subscribed;
          return (
            <Card
              key={plan.id}
              className={cn(
                "flex flex-col shadow-[var(--shadow-card)]",
                active && "border-brand ring-1 ring-brand",
              )}
            >
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  {active && <Badge className="border-0 bg-success text-success-foreground">Current</Badge>}
                </div>
                <p className="text-2xl font-extrabold">
                  {moneyIn(plan.price_ugx, "UGX")}
                  <span className="text-sm font-normal text-muted-foreground">/month</span>
                </p>
                <p className="text-xs text-muted-foreground">{plan.blurb}</p>
                {!status.subscribed && (
                  <p className="text-[11px] font-medium text-muted-foreground">
                    Limits below apply once your 14-day trial ends.
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <ul className="space-y-2 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant={active ? "outline" : "default"}
                  disabled={!isOwner || status.suspended || status.free}
                  onClick={() => pay(plan.id)}
                >
                  {!isOwner
                    ? "Only the owner can pay"
                    : active
                      ? "Renew / add months"
                      : status.subscribed
                        ? `Switch to ${plan.name}`
                        : `Pay for ${plan.name}`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">Modules included per package</CardTitle>
          <p className="text-xs text-muted-foreground">
            {status.onTrial
              ? "Everything is unlocked during your 14-day trial. Once it ends, modules outside your package are hidden from the sidebar until you upgrade."
              : "Locked modules are hidden from the sidebar until the plan is upgraded."}
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 font-semibold">Module</th>
                {PLANS.map((p) => (
                  <th key={p.id} className="py-2 text-center font-semibold">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map(([id, label]) => (
                <tr key={id} className="border-b last:border-0">
                  <td className="py-2 font-medium">{label}</td>
                  {PLANS.map((p) => (
                    <td key={p.id} className="py-2 text-center">
                      {planHasModule(p.id, id) ? (
                        <Check className="mx-auto size-4 text-success" />
                      ) : (
                        <Minus className="mx-auto size-4 text-muted-foreground/50" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {payments.length > 0 && (
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-base">Payment history</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 font-semibold">Date</th>
                  <th className="py-2 font-semibold">Plan</th>
                  <th className="py-2 font-semibold">Amount</th>
                  <th className="py-2 font-semibold">Transaction ID</th>
                  <th className="py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2">{shortDate(p.created_at)}</td>
                    <td className="py-2">
                      {planById(p.plan as PlanId).name} · {p.months} mo
                    </td>
                    <td className="py-2">{moneyIn(Number(p.amount), p.currency)}</td>
                    <td className="py-2 font-mono text-xs">{p.transaction_id}</td>
                    <td className="py-2">
                      <Badge
                        className={cn(
                          "border-0",
                          p.status === "approved" && "bg-success text-success-foreground",
                          p.status === "pending" && "bg-warning text-warning-foreground",
                          p.status === "rejected" && "bg-destructive text-destructive-foreground",
                        )}
                        title={p.note || undefined}
                      >
                        {p.status === "approved"
                          ? "Paid"
                          : p.status === "pending"
                            ? "Confirming"
                            : "Not received"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="flex items-start gap-3 pt-6 text-sm text-muted-foreground">
          <Smartphone className="mt-0.5 size-4 text-brand" />
          <p>
            Send the amount to one of the accounts above, then enter the transaction ID or
            reference from your confirmation. Your plan activates once the payment is matched, and
            paying again adds the months on top of the time you have left.
          </p>
        </CardContent>
      </Card>

      <PaymentDialog
        plan={paying}
        info={billingInfo}
        loading={billingLoading}
        defaultPhone={business.phone}
        onOpenChange={(open) => !open && setPaying(null)}
        onSubmitted={() => queryClient.invalidateQueries({ queryKey: ["subscription-payments"] })}
      />
    </div>
  );
}
