import { Fragment, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight, Trash2 } from "lucide-react";
import {
  isThisMonth,
  outstanding,
  debtStatus,
  type Customer,
  type Debt,
  type Expense,
  type Product,
  type Purchase,
  type Sale,
  type StockTxn,
  type Supplier,
} from "@/lib/data";
import { deleteRow, saleLinesBySale, staffUserId, type StaffRow } from "@/lib/db";
import { profitByCommodity } from "@/lib/profit";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ugx, num, shortDate, paymentLabel, DEBT_STATUS } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export type KpiPanel =
  | "sales"
  | "credit"
  | "expenses"
  | "stock"
  | "customers"
  | "suppliers"
  | "outofstock"
  | "lowstock"
  | "instock"
  | null;

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
  suppliers = [],
  purchases = [],
  movements = [],
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
  suppliers?: Supplier[];
  purchases?: Purchase[];
  /** Stock movements, so an empty shelf can say when it last sold. */
  movements?: StockTxn[];
}) {
  const { isOwner } = useAuth();
  const queryClient = useQueryClient();

  /**
   * Remove a customer, owner only.
   *
   * The server refuses anyone still holding money or empties — debts cascade
   * off the customer row, so deleting one mid-balance would quietly take the
   * record of the money with it. Whatever it says comes straight to the screen.
   */
  const deleteCustomer = async (customer: Customer) => {
    if (
      !window.confirm(
        `Delete ${customer.name}? Their contact details and credit history go with them.`,
      )
    ) {
      return;
    }
    try {
      await deleteRow("customers", customer.id);
      toast.success(`${customer.name} deleted`);
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete that customer");
    }
  };

  const title = {
    sales: "Cash sales breakdown",
    credit: "Credit & outstanding balances",
    expenses: "Operating overheads breakdown",
    stock: "Stock value by item",
    customers: "Customers",
    suppliers: "Suppliers",
    outofstock: "Stopped & out-of-stock products",
    lowstock: "Low stock products",
    instock: "Products in stock",
    "": "",
  }[panel ?? ""];

  const link = {
    sales: { to: "/reports", label: "Open reports" },
    credit: { to: "/debtors", label: "Open debtors" },
    expenses: { to: "/expenses", label: "Open expenses" },
    stock: { to: "/inventory", label: "Open inventory" },
    customers: { to: "/debtors", label: "Open customers" },
    suppliers: { to: "/stock", label: "Open suppliers" },
    outofstock: { to: "/inventory", label: "Open inventory" },
    lowstock: { to: "/inventory", label: "Open inventory" },
    instock: { to: "/inventory", label: "Open inventory" },
  }[panel ?? "sales"];

  return (
    <Dialog open={panel !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {panel === "expenses" && <ExpenseDetail expenses={expenses} staff={staff} />}
          {panel === "sales" && <SalesDetail sales={sales} />}
          {panel === "credit" && <CreditDetail debts={debts} customers={customers} />}
          {panel === "stock" && <StockDetail products={products} />}
          {panel === "customers" && (
            <CustomerDetail
              customers={customers}
              debts={debts}
              isOwner={isOwner}
              onDelete={deleteCustomer}
            />
          )}
          {panel === "suppliers" && <SupplierDetail suppliers={suppliers} purchases={purchases} />}
          {(panel === "outofstock" || panel === "lowstock") && (
            <ShelfDetail
              products={products}
              movements={movements}
              mode={panel === "outofstock" ? "out" : "low"}
            />
          )}
          {panel === "instock" && <InStockDetail products={products} sales={sales} />}
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

/**
 * The money that actually came into the till.
 *
 * Credit has its own tile and its own panel, so it is left out of this one
 * entirely — the totals, the payment methods and the recent rows are all
 * cash-basis. A shop looking at this is asking "what did I take?", and a sale
 * booked on trust is not an answer to that question.
 */
function SalesDetail({ sales }: { sales: Sale[] }) {
  const cash = useMemo(() => sales.filter((s) => s.payment_method !== "credit"), [sales]);

  const byPayment = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const s of cash) {
      const row = map.get(s.payment_method) ?? { total: 0, count: 0 };
      row.total += Number(s.total_amount);
      row.count += 1;
      map.set(s.payment_method, row);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [cash]);

  const recent = useMemo(
    () => [...cash].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 15),
    [cash],
  );

  // What each of those sales actually put across the counter. A customer name
  // and a total say who paid and how much; the owner also wants to know what
  // they walked out with.
  const boughtBySale = useMemo(() => {
    const lines = saleLinesBySale(recent);
    const out = new Map<string, string>();
    for (const sale of recent) {
      const names = (lines.get(sale.id) ?? [])
        .filter((l) => Number(l.quantity) > 0)
        .map((l) => `${l.product_name}${Number(l.quantity) > 1 ? ` ×${num(l.quantity)}` : ""}`);
      out.set(sale.id, names.join(", "));
    }
    return out;
  }, [recent]);

  if (!cash.length) return <Empty what="cash sales" />;

  const profit = cash.reduce((a, s) => a + (Number(s.total_amount) - Number(s.total_cost)), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Cash sales" value={num(cash.length)} />
        <Stat label="Revenue" value={ugx(cash.reduce((a, s) => a + Number(s.total_amount), 0))} />
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
          Most recent cash sales
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Items purchased</TableHead>
              <TableHead>Paid via</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{shortDate(s.created_at)}</TableCell>
                <TableCell className="font-medium">{s.customer_name || "Walk-in"}</TableCell>
                <TableCell className="max-w-[16rem] text-muted-foreground">
                  {boughtBySale.get(s.id) || "—"}
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
        // When the goods actually left the shop — the counter records it on the
        // credit form, and it is the date the owner counts the days from.
        const taken = theirs
          .map((d) => d.issue_date)
          .filter(Boolean)
          .sort();
        return {
          customer,
          debts: theirs,
          balance: theirs.reduce((a, d) => a + outstanding(d), 0),
          overdueValue: overdue.reduce((a, d) => a + outstanding(d), 0),
          nextDue: dues[0] ?? null,
          takenOn: taken[0] ?? null,
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
            <TableHead>Taken on</TableHead>
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
                  <TableCell>{row.takenOn ? shortDate(row.takenOn) : "—"}</TableCell>
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
                    <TableCell colSpan={5} className="p-3">
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
                              {/* What the counter marked on the form. The badge
                                  in the row above carries the live position;
                                  this is the person's own reading of it. */}
                              <span className="ml-1 text-[10px] uppercase tracking-wide">
                                · {DEBT_STATUS[d.status]?.label ?? d.status}
                              </span>
                            </span>
                            <span className="shrink-0 tabular">
                              {ugx(outstanding(d))} · taken {shortDate(d.issue_date)} · due{" "}
                              {shortDate(d.due_date)}
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
              <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
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

/**
 * Every customer, not only the ones who owe money.
 *
 * The credit panel answers "who owes?"; this one is the book itself — the
 * contact, the national ID collected at the counter, where they trade, what
 * they are holding. A tap opens the rest in place.
 */
/**
 * Every customer, sorted into the two kinds a shop actually has.
 *
 * A creditor is someone carrying an unsettled balance; a cash customer is
 * everyone else — they may buy every week, they just never leave owing. The
 * distinction decides who gets chased and who gets served, so it is a tab
 * rather than something to work out from a column of figures.
 *
 * Deleting is the owner's, and the server refuses anyone still holding money
 * or empties: debts cascade off the customer, so removing one mid-balance
 * would take the record of the money with them.
 */
function CustomerDetail({
  customers,
  debts,
  isOwner,
  onDelete,
}: {
  customers: Customer[];
  debts: Debt[];
  isOwner: boolean;
  onDelete: (customer: Customer) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "credit" | "cash">("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers
      .map((customer) => {
        const theirs = debts.filter((d) => d.customer_id === customer.id);
        const live = theirs.filter((d) => debtStatus(d) !== "cleared");
        const owed = live.reduce((a, d) => a + outstanding(d), 0);
        return {
          customer,
          owed,
          open: live.length,
          settled: theirs.length - live.length,
          overdue: live.some((d) => debtStatus(d) === "overdue"),
          // Owing now is what makes someone a creditor. Someone who has taken
          // credit before and cleared it is back to cash, which is the whole
          // point of clearing it.
          creditor: owed > 0,
        };
      })
      .filter((r) => (kind === "all" ? true : kind === "credit" ? r.creditor : !r.creditor))
      .filter(({ customer: c }) =>
        !q
          ? true
          : [c.name, c.phone, c.alt_phone, c.nin, c.location, c.residence]
              .filter(Boolean)
              .some((f) => String(f).toLowerCase().includes(q)),
      )
      .sort((a, b) => b.owed - a.owed || a.customer.name.localeCompare(b.customer.name));
  }, [customers, debts, query, kind]);

  const creditorCount = useMemo(
    () =>
      customers.filter((c) =>
        debts.some(
          (d) => d.customer_id === c.id && debtStatus(d) !== "cleared" && outstanding(d) > 0,
        ),
      ).length,
    [customers, debts],
  );

  if (!customers.length) return <Empty what="customers" />;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Customers" value={num(customers.length)} />
        <Stat label="Creditors" value={num(creditorCount)} />
        <Stat label="Cash basis" value={num(customers.length - creditorCount)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {(
            [
              ["all", "All"],
              ["credit", "Creditors"],
              ["cash", "Cash basis"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                kind === value ? "bg-primary/10 text-primary" : "text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Input
          className="h-8 max-w-xs"
          placeholder="Search a name, phone, NIN or place"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Basis</TableHead>
            <TableHead className="text-right">Owes</TableHead>
            <TableHead className="text-right">Empties</TableHead>
            {isOwner && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ customer: c, owed, open, settled, overdue, creditor }) => {
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
                      {c.phone || "No contact"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        creditor
                          ? overdue
                            ? "border-destructive text-destructive"
                            : "border-warning/60 text-warning-foreground"
                          : "border-success/60 text-success"
                      }
                    >
                      {creditor ? (overdue ? "overdue" : "creditor") : "cash"}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold">
                    {owed > 0 ? ugx(owed) : "—"}
                    {open > 1 && (
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        ({open})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {Number(c.bottles_owed) ? num(c.bottles_owed) : "—"}
                  </TableCell>
                  {isOwner && (
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive"
                        title="Delete this customer"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(c);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
                {isOpen && (
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={isOwner ? 5 : 4} className="p-3">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <Fact label="Phone" value={c.phone} />
                        <Fact label="Other phone" value={c.alt_phone} />
                        <Fact label="National ID (NIN)" value={c.nin} />
                        <Fact label="Location" value={c.location} />
                        <Fact label="Residing place" value={c.residence} />
                        <Fact label="Occupation" value={c.occupation} />
                        <Fact label="Guarantor" value={c.guarantor_name} />
                        <Fact label="Guarantor phone" value={c.guarantor_phone} />
                        <Fact label="Customer since" value={shortDate(c.created_at)} />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {settled > 0
                          ? `${settled} credit sale${settled === 1 ? "" : "s"} settled in full.`
                          : "No credit history."}
                        {c.notes ? ` ${c.notes}` : ""}
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={isOwner ? 5 : 4}
                className="py-6 text-center text-muted-foreground"
              >
                {kind === "credit"
                  ? "Nobody is carrying a balance."
                  : kind === "cash"
                    ? "Every customer is on credit right now."
                    : "No customer matches that search."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** Who the shop buys from, what it still owes them, and how to reach them. */
function SupplierDetail({
  suppliers,
  purchases,
}: {
  suppliers: Supplier[];
  purchases: Purchase[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    return suppliers
      .map((supplier) => {
        const theirs = purchases.filter((p) => p.supplier_id === supplier.id);
        const due = theirs.reduce(
          (a, p) => a + Math.max(0, Number(p.total_amount) - Number(p.amount_paid)),
          0,
        );
        const dates = theirs.map((p) => p.purchase_date).sort();
        return {
          supplier,
          purchases: theirs,
          bought: theirs.reduce((a, p) => a + Number(p.total_amount), 0),
          // The supplier row carries its own balance; a purchase that was never
          // recorded still shows up there, so take whichever is larger.
          due: Math.max(due, Number(supplier.balance ?? 0)),
          last: dates[dates.length - 1] ?? null,
        };
      })
      .sort((a, b) => b.due - a.due || a.supplier.name.localeCompare(b.supplier.name));
  }, [suppliers, purchases]);

  if (!suppliers.length) return <Empty what="suppliers" />;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Suppliers" value={num(suppliers.length)} />
        <Stat label="Bought all time" value={ugx(rows.reduce((a, r) => a + r.bought, 0))} />
        <Stat label="Still owed to them" value={ugx(rows.reduce((a, r) => a + r.due, 0))} />
      </div>

      <p className="text-xs text-muted-foreground">Tap a supplier for their contact details.</p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Supplier</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead className="text-right">Bought</TableHead>
            <TableHead className="text-right">Owed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ supplier, purchases: theirs, bought, due, last }) => {
            const isOpen = openId === supplier.id;
            return (
              <Fragment key={supplier.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => setOpenId(isOpen ? null : supplier.id)}
                >
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      <ChevronRight
                        className={`size-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                      />
                      {supplier.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{supplier.contact || "—"}</TableCell>
                  <TableCell className="tabular text-right">{ugx(bought)}</TableCell>
                  <TableCell
                    className={`tabular text-right font-semibold ${due > 0 ? "text-warning-foreground" : ""}`}
                  >
                    {due > 0 ? ugx(due) : "settled"}
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={4} className="p-3">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <Fact label="Contact" value={supplier.contact} />
                        <Fact label="Email" value={supplier.email} />
                        <Fact label="Address" value={supplier.address} />
                        <Fact label="Last delivery" value={last ? shortDate(last) : ""} />
                      </div>
                      <ul className="mt-3 space-y-1 text-xs">
                        {theirs.slice(0, 6).map((p) => (
                          <li key={p.id} className="flex items-center justify-between gap-3">
                            <span className="truncate text-muted-foreground">
                              {p.reference || "Purchase"} · {shortDate(p.purchase_date)}
                            </span>
                            <span className="shrink-0 tabular">
                              {ugx(p.total_amount)} · {ugx(p.amount_paid)} paid
                            </span>
                          </li>
                        ))}
                        {theirs.length === 0 && (
                          <li className="text-muted-foreground">No purchases recorded yet.</li>
                        )}
                      </ul>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The two shelf warnings, sharing one panel.
 *
 * "Out of stock" and "low stock" are the same question at different depths —
 * what has to be bought, and how badly. The rows carry what the counter sees
 * on the inventory screen: the item, its category, what is on hand, where it
 * reorders, and the two prices. Each opens onto what it costs to refill and
 * when it last moved, which is what decides whether it is worth reordering.
 */
function ShelfDetail({
  products,
  movements,
  mode,
}: {
  products: Product[];
  movements: StockTxn[];
  mode: "out" | "low";
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const lastMoved = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of movements) {
      const at = String(t.created_at);
      if (at > (map.get(t.product_id) ?? "")) map.set(t.product_id, at);
    }
    return map;
  }, [movements]);

  const rows = useMemo(() => {
    const matching =
      mode === "out"
        ? products.filter((p) => Number(p.stock_quantity) <= 0)
        : products.filter(
            (p) =>
              Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= Number(p.reorder_level),
          );

    const priced = matching.map((p) => {
      // Refill to the reorder level at least, and never suggest zero.
      const target = Math.max(Number(p.reorder_level), 1);
      const shortfall = Math.max(0, target - Number(p.stock_quantity));
      return {
        product: p,
        shortfall,
        cost: shortfall * Number(p.unit_buying_price),
        moved: lastMoved.get(p.id) ?? null,
      };
    });

    return priced.sort((a, b) => b.cost - a.cost);
  }, [products, mode, lastMoved]);

  if (!rows.length) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {mode === "out"
          ? "Nothing is out of stock. Every item has something on the shelf."
          : "Nothing is below its reorder level."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat
          label={mode === "out" ? "Out of stock" : "Below reorder level"}
          value={num(rows.length)}
        />
        <Stat label="Units to buy" value={num(rows.reduce((a, r) => a + r.shortfall, 0))} />
        <Stat label="Cost to refill" value={ugx(rows.reduce((a, r) => a + r.cost, 0))} />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">On hand</TableHead>
            <TableHead className="text-right">Reorder at</TableHead>
            <TableHead className="text-right">Buys at</TableHead>
            <TableHead className="text-right">Sells at</TableHead>
            <TableHead className="text-right">To buy</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ product: p, shortfall, cost, moved }) => {
            const isOpen = openId === p.id;
            return (
              <Fragment key={p.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => setOpenId(isOpen ? null : p.id)}
                >
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      <ChevronRight
                        className={`size-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                      />
                      {p.name}
                    </span>
                    <span className="ml-5 text-[11px] text-muted-foreground">{p.category}</span>
                  </TableCell>
                  <TableCell
                    className={`tabular text-right font-semibold ${
                      Number(p.stock_quantity) <= 0 ? "text-destructive" : "text-warning-foreground"
                    }`}
                  >
                    {num(p.stock_quantity)}
                  </TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {num(p.reorder_level)}
                  </TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {ugx(p.unit_buying_price)}
                  </TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {ugx(p.unit_selling_price)}
                  </TableCell>
                  <TableCell className="tabular text-right">{num(shortfall)}</TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={6} className="p-3">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <Fact label="Buys at" value={ugx(p.unit_buying_price)} />
                        <Fact label="Sells at" value={ugx(p.unit_selling_price)} />
                        <Fact label="Cost to refill" value={ugx(cost)} />
                        <Fact
                          label="Last movement"
                          value={moved ? shortDate(moved) : "Never moved"}
                        />
                        <Fact label="Added by" value={p.created_by_name} />
                        <Fact
                          label="Expiry"
                          value={p.expiry_date ? shortDate(p.expiry_date) : ""}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Every commodity on the shelf, read as a purchase: how many were bought, what
 * one carton cost, and what the whole lot cost.
 *
 * Two figures sit side by side and are never added together. "Earned" is
 * revenue less the buying price of the units that actually sold — the gross
 * profit in the statement, split per item. "Cash balance in stock" is what the
 * units still on the shelf would make at the list price, less what they cost to
 * buy: money the store is holding, not money it has made. An item priced below
 * what it cost would drag that balance negative, which reads as a debt the shop
 * does not have, so the balance is floored at zero.
 */
function InStockDetail({ products, sales }: { products: Product[]; sales: Sale[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const { rows, stockProfit, stockRetail, stockCost, earned } = useMemo(() => {
    const report = profitByCommodity(products, sales);
    const onShelf = report.rows.filter((r) => r.onHand > 0);
    return {
      rows: [...onShelf].sort((a, b) => b.stockProfit - a.stockProfit),
      stockProfit: onShelf.reduce((a, r) => a + Math.max(0, r.stockProfit), 0),
      stockRetail: onShelf.reduce((a, r) => a + r.stockRetail, 0),
      stockCost: onShelf.reduce((a, r) => a + r.stockCost, 0),
      earned: onShelf.reduce((a, r) => a + r.earned, 0),
    };
  }, [products, sales]);

  if (!rows.length) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nothing is on the shelf — every product has run down to zero.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Commodities in stock" value={num(rows.length)} />
        <Stat label="Cash balance in stock" value={ugx(stockProfit)} />
        <Stat label="Earned by these items" value={ugx(earned)} />
      </div>

      <p className="text-xs text-muted-foreground">
        The shelf cost {ugx(stockCost)} to buy and is priced at {ugx(stockRetail)}, leaving a cash
        balance in stock of {ugx(stockProfit)} — what it would make if it all sold, counting nothing
        for anything priced below what it cost. It has not been earned, so it is never added to the{" "}
        {ugx(earned)} these items have already made on the sales on file. Tap an item for its
        figures.
      </p>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Quantity purchased</TableHead>
              <TableHead className="text-right">Cost per carton</TableHead>
              <TableHead className="text-right">Total purchase cost</TableHead>
              <TableHead className="text-right">Cash balance in stock</TableHead>
              <TableHead className="text-right">Earned</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const isOpen = openId === r.productId;
              const p = r.product;
              return (
                <Fragment key={r.productId}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => setOpenId(isOpen ? null : r.productId)}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        <ChevronRight
                          className={`size-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                        {r.name}
                      </span>
                      <span className="ml-5 text-[11px] text-muted-foreground">{r.category}</span>
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {num(r.onHand)}
                    </TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">
                      {ugx(p?.unit_buying_price ?? 0)}
                    </TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">
                      {ugx(r.stockCost)}
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {ugx(Math.max(0, r.stockProfit))}
                    </TableCell>
                    <TableCell
                      className={`tabular text-right ${r.earned > 0 ? "text-success" : "text-muted-foreground"}`}
                    >
                      {r.soldQty > 0 ? ugx(r.earned) : "—"}
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={6} className="p-3">
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <Fact label="On the shelf at retail" value={ugx(r.stockRetail)} />
                          <Fact label="Total purchase cost" value={ugx(r.stockCost)} />
                          <Fact
                            label="Purchase price from supplier"
                            value={p?.supplier_price != null ? ugx(p.supplier_price) : "—"}
                          />
                          <Fact
                            label="Cash balance in stock"
                            value={ugx(Math.max(0, r.stockProfit))}
                          />
                          <Fact label="Reorder at" value={num(p?.reorder_level ?? 0)} />
                          <Fact label="Units sold" value={num(r.soldQty)} />
                          <Fact label="Revenue earned" value={ugx(r.revenue)} />
                          <Fact label="Buying price of those units" value={ugx(r.buyingPrice)} />
                          <Fact label="Gross profit earned" value={ugx(r.earned)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function StockDetail({ products }: { products: Product[] }) {
  if (!products.length) return <Empty what="stock" />;

  const rows = products
    .map((p) => {
      const cost = Number(p.unit_buying_price) * Number(p.stock_quantity);
      const retail = Number(p.unit_selling_price) * Number(p.stock_quantity);
      // What the shelf would make at the list price. Not earned, and never
      // added to the gross profit the shop has actually taken.
      return { p, cost, retail, profit: retail - cost };
    })
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 20);

  const totals = products.reduce(
    (acc, p) => {
      acc.cost += Number(p.unit_buying_price) * Number(p.stock_quantity);
      acc.retail += Number(p.unit_selling_price) * Number(p.stock_quantity);
      return acc;
    },
    { cost: 0, retail: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="At buying price" value={ugx(totals.cost)} />
        <Stat label="At retail" value={ugx(totals.retail)} />
        <Stat label="Profit held in stock" value={ugx(totals.retail - totals.cost)} />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">At buying price</TableHead>
            <TableHead className="text-right">At retail</TableHead>
            <TableHead className="text-right">Profit in stock</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ p, cost, retail, profit }) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell className="text-right">{num(p.stock_quantity)}</TableCell>
              <Money>{ugx(cost)}</Money>
              <TableCell className="tabular text-right text-muted-foreground">
                {ugx(retail)}
              </TableCell>
              <TableCell
                className={`tabular text-right font-semibold ${profit < 0 ? "text-destructive" : ""}`}
              >
                {ugx(profit)}
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
