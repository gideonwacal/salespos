import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, Lightbulb, Minus, Sparkles } from "lucide-react";
import {
  PLANS,
  planById,
  planHasModule,
  trialStatus,
  activateSubscription,
  type ModuleId,
  type PlanId,
} from "@/lib/demo";
import { useBusiness } from "@/hooks/useBusiness";
import { useStaff, useCustomers, useDebts, useQuotations } from "@/lib/data";
import { useIndustry } from "@/hooks/useIndustry";
import { recommendPlan } from "@/lib/planAdvice";
import { shortDate } from "@/lib/format";
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

  const pay = (id: PlanId) => {
    activateSubscription(id, 1);
    toast.success(`${planById(id).name} plan activated — thank you!`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Plan & billing</h1>
        <p className="text-sm text-muted-foreground">
          {staff.length} of {current.seats === 999 ? "unlimited" : current.seats} seats used ·{" "}
          {status.subscribed
            ? `subscription active until ${shortDate(business.paid_until ?? "")}`
            : status.onTrial
              ? `trial ends ${shortDate(business.trial_ends)} (${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"} left)`
              : "trial ended"}
        </p>
      </div>

      {!status.subscribed && (
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
                : `You are on the free trial — ${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"} remaining.`}
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
            <Button size="sm" onClick={() => pay(advice.recommended)}>
              Move to {advised.name} &mdash; ${advised.price}/month
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
                <p className="text-3xl font-extrabold">
                  ${plan.price}
                  <span className="text-sm font-normal text-muted-foreground">/month</span>
                </p>
                <p className="text-xs text-muted-foreground">{plan.blurb}</p>
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
                  disabled={active}
                  onClick={() => pay(plan.id)}
                >
                  {active
                    ? "Current plan"
                    : status.subscribed
                      ? `Switch to ${plan.name}`
                      : `Pay $${plan.price} — activate ${plan.name}`}
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
            Locked modules are hidden from the sidebar until the plan is upgraded.
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

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="flex items-start gap-3 pt-6 text-sm text-muted-foreground">
          <Sparkles className="mt-0.5 size-4 text-brand" />
          <p>
            Plan changes apply instantly in this prototype. Connect your payment provider when you
            wire up your own backend to charge for upgrades automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
