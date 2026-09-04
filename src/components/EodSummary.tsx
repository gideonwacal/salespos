import { ClipboardCheck } from "lucide-react";
import {
  useSales,
  useExpenses,
  useDebts,
  useDebtPayments,
  useCustomers,
  isToday,
  outstanding,
  debtStatus,
} from "@/lib/data";
import { ugx, num, paymentLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** One-click end-of-day reconciliation: cash, credit, collections and bottles. */
export function EodSummaryDialog() {
  const { data: sales = [] } = useSales();
  const { data: expenses = [] } = useExpenses();
  const { data: debts = [] } = useDebts();
  const { data: payments = [] } = useDebtPayments();
  const { data: customers = [] } = useCustomers();

  const today = sales.filter((s) => isToday(s.created_at));
  const byMethod = today.reduce<Record<string, number>>((acc, s) => {
    acc[s.payment_method] = (acc[s.payment_method] ?? 0) + Number(s.total_amount);
    return acc;
  }, {});
  const gross = today.reduce((a, s) => a + Number(s.total_amount), 0);
  const cost = today.reduce((a, s) => a + Number(s.total_cost), 0);
  const spend = expenses
    .filter((e) => e.expense_date === new Date().toISOString().slice(0, 10))
    .reduce((a, e) => a + Number(e.amount), 0);
  const collected = payments
    .filter((p) => isToday(p.created_at))
    .reduce((a, p) => a + Number(p.amount), 0);
  const outstandingTotal = debts
    .filter((d) => debtStatus(d) !== "cleared")
    .reduce((a, d) => a + outstanding(d), 0);
  const bottles = customers.reduce((a, c) => a + Number(c.bottles_owed), 0);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          id="tour-eod"
          size="sm"
          variant="ghost"
          className="text-brand-foreground hover:bg-brand-muted hover:text-brand-foreground"
        >
          <ClipboardCheck className="size-4" />
          <span className="hidden sm:inline">End of day</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>End-of-day reconciliation</DialogTitle>
          <DialogDescription>{new Date().toLocaleDateString("en-GB")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <Row label="Gross sales" value={ugx(gross)} strong />
          {Object.entries(byMethod).map(([m, v]) => (
            <Row key={m} label={`— ${paymentLabel(m)}`} value={ugx(v)} muted />
          ))}
          <Row label="Debts collected today" value={ugx(collected)} />
          <Row label="Expenses paid today" value={`-${ugx(spend)}`} />
          <Row label="Gross profit" value={ugx(gross - cost)} strong />
          <div className="my-2 border-t border-dashed border-border" />
          <Row label="Outstanding debtor balance" value={ugx(outstandingTotal)} />
          <Row label="Empties still out" value={`${num(bottles)} bottles`} />
          <Row
            label="Expected cash in drawer"
            value={ugx((byMethod["cash"] ?? 0) + collected - spend)}
            strong
          />
          <Button variant="outline" className="no-print mt-3 w-full" onClick={() => window.print()}>
            Print summary
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? "text-xs text-muted-foreground" : "text-muted-foreground"}>
        {label}
      </span>
      <span className={`tabular ${strong ? "font-extrabold" : muted ? "text-xs" : "font-semibold"}`}>
        {value}
      </span>
    </div>
  );
}
