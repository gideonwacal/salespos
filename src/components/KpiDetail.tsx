import { Fragment, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight } from "lucide-react";
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
import { staffUserId, type StaffRow } from "@/lib/db";
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
  staff = [],
}: {
  panel: KpiPanel;
  onClose: () => void;
  sales: Sale[];
  expenses: Expense[];
  debts: Debt[];
  customers: Customer[];
  products: Product[];
  /** Used to put a name against the person who logged each expense. */
  staff?: StaffRow[];
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
          {panel === "expenses" && <ExpenseDetail expenses={expenses} staff={staff} />}
          {panel === "sales" && <SalesDetail sales={sales} debts={debts} />}
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

function ExpenseDetail({ expenses, staff }: { expenses: Expense[]; staff: StaffRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  /** Whoever keyed the expense in. Money going out has a person behind it, and
   * "which of my staff spent this?" is the question the total is hiding. */
  const nameFor = useMemo(() => {
    const byId = new Map(staff.map((s) => [staffUserId(s), s.full_name || s.email]));
    return (id: string | null) => (id ? (byId.get(id) ?? "Removed user") : "Not recorded");
  }, [staff]);

  const { byCategory, byStaff, monthTotal, allTotal } = useMemo(() => {
    const month = expenses.filter((e) => isThisMonth(e.expense_date));
    const map = new Map<string, { total: number; count: number }>();
    for (const e of month) {
      const row = map.get(e.category) ?? { total: 0, count: 0 };
      row.total += Number(e.amount);
      row.count += 1;
      map.set(e.category, row);
    }

    // Staff totals run over all time, not just this month: a pattern in who is
    // spending only shows up over more than four weeks.
    const people = new Map<string, { total: number; count: number; last: string }>();
    for (const e of expenses) {
      const key = e.logged_by ?? "";
      const row = people.get(key) ?? { total: 0, count: 0, last: "" };
      row.total += Number(e.amount);
      row.count += 1;
      if (String(e.expense_date) > row.last) row.last = String(e.expense_date);
      people.set(key, row);
    }

    return {
      byCategory: [...map.entries()].sort((a, b) => b[1].total - a[1].total),
      byStaff: [...people.entries()].sort((a, b) => b[1].total - a[1].total),
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
          Logged by staff, all time
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Who logged it</TableHead>
              <TableHead className="text-right">Entries</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Last entry</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byStaff.map(([id, row]) => (
              <TableRow key={id || "unknown"}>
                <TableCell className="font-medium">{nameFor(id || null)}</TableCell>
                <TableCell className="text-right">{num(row.count)}</TableCell>
                <Money>{ugx(row.total)}</Money>
                <TableCell className="text-right text-muted-foreground">
                  {row.last ? shortDate(row.last) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Most recent — tap a row for the detail
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Logged by</TableHead>
              <TableHead>Paid to</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((e) => {
              const isOpen = openId === e.id;
              return (
                <Fragment key={e.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => setOpenId(isOpen ? null : e.id)}
                  >
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <ChevronRight
                          className={`size-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                        {shortDate(e.expense_date)}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{e.category}</TableCell>
                    <TableCell>{nameFor(e.logged_by)}</TableCell>
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

                  {isOpen && (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={6} className="p-3">
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <Fact label="Logged by" value={nameFor(e.logged_by)} />
                          <Fact label="Paid via" value={paymentLabel(e.payment_method)} />
                          <Fact label="Paid to" value={e.vendor} />
                          <Fact label="Logged on" value={shortDate(e.created_at)} />
                        </div>
                        {e.description && (
                          <p className="mt-2 text-xs text-muted-foreground">{e.description}</p>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function SalesDetail({ sales, debts }: { sales: Sale[]; debts: Debt[] }) {
  // Credit is the half of "total sales" that has not been paid for. Showing
  // the two together is the point: a record month on paper can be a month
  // where nothing came into the till.
  const credit = useMemo(() => {
    const onCredit = sales.filter((s) => s.payment_method === "credit");
    return {
      count: onCredit.length,
      value: onCredit.reduce((a, s) => a + Number(s.total_amount), 0),
      owed: debts.reduce((a, d) => a + outstanding(d), 0),
      overdue: debts
        .filter((d) => debtStatus(d) === "overdue")
        .reduce((a, d) => a + outstanding(d), 0),
    };
  }, [sales, debts]);

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

      <div className="grid gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 p-2 sm:grid-cols-3">
        <Stat label={`Credit sales (${num(credit.count)})`} value={ugx(credit.value)} />
        <Stat label="Still owed" value={ugx(credit.owed)} />
        <Stat label="Of which overdue" value={ugx(credit.overdue)} />
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

/**
 * Who the credit is with, one row per person, opening onto their details.
 *
 * The old panel listed debts, which is the accountant's view. The owner's
 * question is "who owes me and how do I reach them?", so this groups by
 * customer and expands in place — a tap gives the phone, the national ID and
 * where they trade, without leaving the dashboard.
 */
function CreditDetail({ debts, customers }: { debts: Debt[]; customers: Customer[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const creditors = useMemo(() => {
    return customers
      .map((customer) => {
        const theirs = debts.filter(
          (d) => d.customer_id === customer.id && debtStatus(d) !== "cleared",
        );
        const overdue = theirs.filter((d) => debtStatus(d) === "overdue");
        const dues = theirs.map((d) => d.due_date).sort();
        return {
          customer,
          debts: theirs,
          balance: theirs.reduce((a, d) => a + outstanding(d), 0),
          overdueValue: overdue.reduce((a, d) => a + outstanding(d), 0),
          nextDue: dues[0] ?? null,
        };
      })
      .filter((row) => row.debts.length > 0)
      .sort((a, b) => b.overdueValue - a.overdueValue || b.balance - a.balance);
  }, [customers, debts]);

  if (!debts.length) return <Empty what="credit accounts" />;

  const totalOwed = creditors.reduce((a, c) => a + c.balance, 0);
  const overdueCount = debts.filter((d) => debtStatus(d) === "overdue").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="People on credit" value={num(creditors.length)} />
        <Stat label="Outstanding" value={ugx(totalOwed)} />
        <Stat label="Overdue debts" value={num(overdueCount)} />
      </div>

      <p className="text-xs text-muted-foreground">Tap a name to see their details.</p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Creditor</TableHead>
            <TableHead>Next due</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Owed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {creditors.map((row) => {
            const c = row.customer;
            const isOpen = openId === c.id;
            return (
              <Fragment key={c.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => setOpenId(isOpen ? null : c.id)}
                >
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      <ChevronRight
                        className={`size-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                      />
                      {c.name}
                    </span>
                    <span className="ml-5 text-[11px] text-muted-foreground">
                      {c.phone || "No contact"} · {row.debts.length} open
                    </span>
                  </TableCell>
                  <TableCell>{row.nextDue ? shortDate(row.nextDue) : "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={row.overdueValue > 0 ? "border-destructive text-destructive" : ""}
                    >
                      {row.overdueValue > 0 ? "overdue" : "on terms"}
                    </Badge>
                  </TableCell>
                  <Money>{ugx(row.balance)}</Money>
                </TableRow>

                {isOpen && (
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={4} className="p-3">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <Fact label="Phone" value={c.phone} />
                        <Fact label="Other phone" value={c.alt_phone} />
                        <Fact label="National ID (NIN)" value={c.nin} />
                        <Fact label="Location" value={c.location} />
                        <Fact label="Residing place" value={c.residence} />
                        <Fact label="Occupation" value={c.occupation} />
                        <Fact label="Guarantor" value={c.guarantor_name} />
                        <Fact label="Guarantor phone" value={c.guarantor_phone} />
                        <Fact
                          label="Credit limit"
                          value={Number(c.credit_limit) > 0 ? ugx(Number(c.credit_limit)) : ""}
                        />
                      </div>

                      <ul className="mt-3 space-y-1 text-xs">
                        {row.debts.map((d) => (
                          <li key={d.id} className="flex items-center justify-between gap-3">
                            <span className="truncate text-muted-foreground">
                              {d.items_summary || "Credit"}
                            </span>
                            <span className="shrink-0 tabular">
                              {ugx(outstanding(d))} · due {shortDate(d.due_date)}
                            </span>
                          </li>
                        ))}
                      </ul>

                      {c.notes && <p className="mt-2 text-xs text-muted-foreground">{c.notes}</p>}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
          {creditors.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                Every credit account is settled.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** One recorded detail, or an honest blank. */
function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xs ${value ? "" : "text-muted-foreground"}`}>{value || "Not recorded"}</p>
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
