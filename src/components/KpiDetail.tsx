import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import {
  isThisMonth,
  outstanding,
  debtStatus,
  type Customer,
  type Debt,
  type Expense,
  type Product,
  type Sale,
} from "@/lib/data";
import { ugx, num, shortDate, paymentLabel } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type KpiPanel = "sales" | "credit" | "expenses" | "stock" | null;

/**
 * The rows behind a dashboard headline.
 *
 * A number on its own tells the owner something is wrong but not what: the
 * expenses tile says overheads are up, and the next question is always which
 * ones. This opens the same figure broken down, with a way through to the full
 * page.
 */
export function KpiDetail({
  panel,
  onClose,
  sales,
  expenses,
  debts,
  customers,
  products,
}: {
  panel: KpiPanel;
  onClose: () => void;
  sales: Sale[];
  expenses: Expense[];
  debts: Debt[];
  customers: Customer[];
  products: Product[];
}) {
  const title = {
    sales: "Sales breakdown",
    credit: "Credit & outstanding balances",
    expenses: "Expenses breakdown",
    stock: "Stock value by item",
    "": "",
  }[panel ?? ""];

  const link = {
    sales: { to: "/reports", label: "Open reports" },
    credit: { to: "/debtors", label: "Open debtors" },
    expenses: { to: "/expenses", label: "Open expenses" },
    stock: { to: "/inventory", label: "Open inventory" },
  }[panel ?? "sales"];

  return (
    <Dialog open={panel !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {panel === "expenses" && <ExpenseDetail expenses={expenses} />}
          {panel === "sales" && <SalesDetail sales={sales} />}
          {panel === "credit" && <CreditDetail debts={debts} customers={customers} />}
          {panel === "stock" && <StockDetail products={products} />}
        </div>

        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <Link to={link.to} onClick={onClose}>
              {link.label} <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

function Money({ children }: { children: React.ReactNode }) {
  return <TableCell className="tabular text-right font-semibold">{children}</TableCell>;
}

function Empty({ what }: { what: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">No {what} yet.</p>;
}

function ExpenseDetail({ expenses }: { expenses: Expense[] }) {
  const { byCategory, monthTotal, allTotal } = useMemo(() => {
    const month = expenses.filter((e) => isThisMonth(e.expense_date));
    const map = new Map<string, { total: number; count: number }>();
    for (const e of month) {
      const row = map.get(e.category) ?? { total: 0, count: 0 };
      row.total += Number(e.amount);
      row.count += 1;
      map.set(e.category, row);
    }
    return {
      byCategory: [...map.entries()].sort((a, b) => b[1].total - a[1].total),
      monthTotal: month.reduce((a, e) => a + Number(e.amount), 0),
      allTotal: expenses.reduce((a, e) => a + Number(e.amount), 0),
    };
  }, [expenses]);

  if (!expenses.length) return <Empty what="expenses logged" />;

  const recent = [...expenses]
    .sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)))
    .slice(0, 15);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <Stat label="This month" value={ugx(monthTotal)} />
        <Stat label="All time" value={ugx(allTotal)} />
      </div>

      <section>
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          By category, this month
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Entries</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byCategory.map(([category, row]) => (
              <TableRow key={category}>
                <TableCell className="font-medium">{category}</TableCell>
                <TableCell className="text-right">{num(row.count)}</TableCell>
                <Money>{ugx(row.total)}</Money>
                <TableCell className="text-right text-muted-foreground">
                  {monthTotal ? Math.round((row.total / monthTotal) * 100) : 0}%
                </TableCell>
              </TableRow>
            ))}
            {byCategory.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Nothing logged this month.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Most recent
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Paid to</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{shortDate(e.expense_date)}</TableCell>
                <TableCell className="font-medium">{e.category}</TableCell>
                <TableCell className="text-muted-foreground">{e.vendor ?? "—"}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      e.status === "approved"
                        ? "border-success text-success"
                        : e.status === "rejected"
                          ? "border-destructive text-destructive"
                          : ""
                    }
                  >
                    {e.status ?? "pending"}
                  </Badge>
                </TableCell>
                <Money>{ugx(e.amount)}</Money>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function SalesDetail({ sales }: { sales: Sale[] }) {
  const byPayment = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const s of sales) {
      const row = map.get(s.payment_method) ?? { total: 0, count: 0 };
      row.total += Number(s.total_amount);
      row.count += 1;
      map.set(s.payment_method, row);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [sales]);

  if (!sales.length) return <Empty what="sales" />;

  const recent = [...sales]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 15);
  const profit = sales.reduce(
    (a, s) => a + (Number(s.total_amount) - Number(s.total_cost)),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Sales" value={num(sales.length)} />
        <Stat
          label="Revenue"
          value={ugx(sales.reduce((a, s) => a + Number(s.total_amount), 0))}
        />
        <Stat label="Gross profit" value={ugx(profit)} />
      </div>

      <section>
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          By payment method
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byPayment.map(([method, row]) => (
              <TableRow key={method}>
                <TableCell className="font-medium">{paymentLabel(method)}</TableCell>
                <TableCell className="text-right">{num(row.count)}</TableCell>
                <Money>{ugx(row.total)}</Money>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Most recent
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Paid via</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{shortDate(s.created_at)}</TableCell>
                <TableCell className="font-medium">
                  {s.customer_name || "Walk-in"}
                </TableCell>
                <TableCell>{paymentLabel(s.payment_method)}</TableCell>
                <Money>{ugx(s.total_amount)}</Money>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function CreditDetail({ debts, customers }: { debts: Debt[]; customers: Customer[] }) {
  if (!debts.length) return <Empty what="credit accounts" />;

  const nameFor = (id: string) =>
    customers.find((c) => c.id === id)?.name ?? "Unknown customer";

  const open = debts
    .filter((d) => outstanding(d) > 0)
    .sort((a, b) => outstanding(b) - outstanding(a));

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Open accounts" value={num(open.length)} />
        <Stat
          label="Outstanding"
          value={ugx(open.reduce((a, d) => a + outstanding(d), 0))}
        />
        <Stat
          label="Overdue"
          value={num(debts.filter((d) => debtStatus(d) === "overdue").length)}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Owed</TableHead>
            <TableHead className="text-right">Paid</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {open.map((d) => {
            const status = debtStatus(d);
            return (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{nameFor(d.customer_id)}</TableCell>
                <TableCell>{shortDate(d.due_date)}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={status === "overdue" ? "border-destructive text-destructive" : ""}
                  >
                    {status}
                  </Badge>
                </TableCell>
                <Money>{ugx(outstanding(d))}</Money>
                <TableCell className="tabular text-right text-muted-foreground">
                  {ugx(d.amount_paid)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function StockDetail({ products }: { products: Product[] }) {
  if (!products.length) return <Empty what="stock" />;

  const rows = products
    .map((p) => ({
      p,
      cost: Number(p.unit_buying_price) * Number(p.stock_quantity),
      retail: Number(p.unit_selling_price) * Number(p.stock_quantity),
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 20);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <Stat
          label="At cost"
          value={ugx(
            products.reduce(
              (a, p) => a + Number(p.unit_buying_price) * Number(p.stock_quantity),
              0,
            ),
          )}
        />
        <Stat
          label="At retail"
          value={ugx(
            products.reduce(
              (a, p) => a + Number(p.unit_selling_price) * Number(p.stock_quantity),
              0,
            ),
          )}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">At cost</TableHead>
            <TableHead className="text-right">At retail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ p, cost, retail }) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell className="text-right">{num(p.stock_quantity)}</TableCell>
              <Money>{ugx(cost)}</Money>
              <TableCell className="tabular text-right text-muted-foreground">
                {ugx(retail)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {products.length > 20 && (
        <p className="text-xs text-muted-foreground">
          Showing the 20 highest-value items of {num(products.length)}.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="tabular text-lg font-extrabold">{value}</p>
    </div>
  );
}
