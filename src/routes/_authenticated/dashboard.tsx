import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  TrendingUp,
  Boxes,
  AlertTriangle,
  Receipt,
  HandCoins,
  Users,
  Truck,
  PackageX,
  PackageSearch,
  FileText,
  ShoppingCart,
  CalendarClock,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiDetail, type KpiPanel } from "@/components/KpiDetail";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useProducts,
  useSales,
  useExpenses,
  useStockTransactions,
  useDebts,
  useCustomers,
  useStaff,
  useSuppliers,
  usePurchases,
  isToday,
  isThisMonth,
  daysToExpiry,
  outstanding,
  debtStatus,
  EXPIRY_WARNING_DAYS,
} from "@/lib/data";
import { ugx, num, timeAgo, paymentLabel } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Business Dashboard — SalesPos" },
      {
        name: "description",
        content:
          "Live sales, credit sales, expenses, stock valuation, staff and supplier metrics for your business.",
      },
      { property: "og:title", content: "Business Dashboard — SalesPos" },
      {
        property: "og:description",
        content: "Live sales, credit, expenses and stock intelligence in one console.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: products = [] } = useProducts();
  const { data: sales = [] } = useSales();
  const { data: expenses = [] } = useExpenses();
  const { data: movements = [] } = useStockTransactions();
  const { data: debts = [] } = useDebts();
  const { data: customers = [] } = useCustomers();
  const { data: staff = [] } = useStaff();
  const activeStaff = staff.filter((s) => (s as { active?: boolean }).active !== false).length;
  // Which headline the owner has opened up. A figure alone says something
  // moved; the rows behind it say what.
  const [panel, setPanel] = useState<KpiPanel>(null);
  const { data: suppliers = [] } = useSuppliers();
  const { data: purchases = [] } = usePurchases();

  const m = useMemo(() => {
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    const todaySales = sales.filter((s) => isToday(s.created_at));
    const monthSales = sales.filter((s) => isThisMonth(s.created_at));
    const monthExpenses = expenses.filter((e) => isThisMonth(e.expense_date));

    const totalSales = sum(sales.map((s) => Number(s.total_amount)));
    const todayTotal = sum(todaySales.map((s) => Number(s.total_amount)));
    const monthTotal = sum(monthSales.map((s) => Number(s.total_amount)));
    const cogs = sum(monthSales.map((s) => Number(s.total_cost)));
    const overheads = sum(monthExpenses.map((e) => Number(e.amount)));
    const creditSales = sum(
      sales.filter((s) => s.payment_method === "credit").map((s) => Number(s.total_amount)),
    );
    const outstandingDebt = sum(debts.map(outstanding));
    const overdue = debts.filter((d) => debtStatus(d) === "overdue");
    const purchasesTotal = sum(purchases.map((p) => Number(p.total_amount)));
    const supplierDue = sum(
      purchases.map((p) => Math.max(0, Number(p.total_amount) - Number(p.amount_paid))),
    );

    const stockValue = sum(
      products.map((p) => Number(p.unit_buying_price) * Number(p.stock_quantity)),
    );
    const retailValue = sum(
      products.map((p) => Number(p.unit_selling_price) * Number(p.stock_quantity)),
    );
    const outOfStock = products.filter((p) => Number(p.stock_quantity) <= 0);
    const lowStock = products.filter(
      (p) => Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= Number(p.reorder_level),
    );
    const expiring = products
      .map((p) => ({ p, d: daysToExpiry(p.expiry_date) }))
      .filter((x) => x.d !== null && (x.d as number) <= EXPIRY_WARNING_DAYS)
      .sort((a, b) => (a.d as number) - (b.d as number));

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = d.toISOString().slice(0, 10);
      const rows = sales.filter((s) => s.created_at.slice(0, 10) === key);
      return {
        day: d.toLocaleDateString("en-GB", { weekday: "short" }),
        sales: sum(rows.map((s) => Number(s.total_amount))),
        profit: sum(rows.map((s) => Number(s.total_amount) - Number(s.total_cost))),
      };
    });

    return {
      totalSales,
      todayTotal,
      todayCount: todaySales.length,
      monthTotal,
      monthCount: monthSales.length,
      grossProfit: monthTotal - cogs,
      netIncome: monthTotal - cogs - overheads,
      overheads,
      expensesTotal: sum(expenses.map((e) => Number(e.amount))),
      creditSales,
      outstandingDebt,
      overdueCount: overdue.length,
      purchasesTotal,
      supplierDue,
      stockValue,
      retailValue,
      inStock: products.filter((p) => Number(p.stock_quantity) > 0).length,
      outOfStock,
      lowStock,
      expiring,
      days,
    };
  }, [products, sales, expenses, debts, purchases]);

  return (
    <div className="relative space-y-6">
      <div className="pointer-events-none absolute -left-16 -top-24 -z-10 size-72 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-40 -z-10 size-80 rounded-full bg-success/15 blur-3xl" />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Business dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Live position across sales, credit, stock and accounting.
          </p>
        </div>
        <Badge className="border-0 bg-success text-success-foreground">
          {m.todayCount} sales today · {ugx(m.todayTotal)}
        </Badge>
      </header>

      {(m.lowStock.length > 0 || m.outOfStock.length > 0 || m.overdueCount > 0) && (
        <div className="grid gap-2 sm:grid-cols-3">
          {m.outOfStock.length > 0 && (
            <Alert tone="destructive" text={`${m.outOfStock.length} product(s) out of stock`} />
          )}
          {m.lowStock.length > 0 && (
            <Alert tone="warning" text={`${m.lowStock.length} product(s) below reorder level`} />
          )}
          {m.overdueCount > 0 && (
            <Alert tone="destructive" text={`${m.overdueCount} overdue debtor account(s)`} />
          )}
        </div>
      )}

      {/* Headline cards */}
      <KpiDetail
        panel={panel}
        onClose={() => setPanel(null)}
        sales={sales}
        expenses={expenses}
        debts={debts}
        customers={customers}
        products={products}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={TrendingUp}
          label="Total sales"
          value={ugx(m.totalSales)}
          hint={`${ugx(m.monthTotal)} this month`}
          tone="primary"
          onExpand={() => setPanel("sales")}
        />
        <Kpi
          icon={HandCoins}
          label="Credit sales"
          value={ugx(m.creditSales)}
          hint={`${ugx(m.outstandingDebt)} still outstanding`}
          tone="warning"
          onExpand={() => setPanel("credit")}
        />
        <Kpi
          icon={Receipt}
          label="Total expenses"
          value={ugx(m.expensesTotal)}
          hint={`${ugx(m.overheads)} this month`}
          tone="destructive"
          onExpand={() => setPanel("expenses")}
        />
        <Kpi
          icon={Boxes}
          label="Stock value"
          value={ugx(m.stockValue)}
          hint={`${ugx(m.retailValue)} at retail`}
          tone="success"
          onExpand={() => setPanel("stock")}
        />
      </section>

      {/* Reports strip */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Reports</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Mini label="Sales" value={ugx(m.monthTotal)} sub={`${m.monthCount} this month`} />
          <Mini label="Credit sales" value={ugx(m.creditSales)} sub={`${m.overdueCount} overdue`} />
          <Mini label="Purchases" value={ugx(m.purchasesTotal)} sub={`${ugx(m.supplierDue)} due`} />
          <Mini label="Products in stock" value={num(m.inStock)} sub={`${products.length} total`} />
          <Mini label="Out of stock" value={num(m.outOfStock.length)} sub="Needs restocking" />
          <Mini label="Low stock items" value={num(m.lowStock.length)} sub="Below reorder level" />
          <Mini
            label="Net income"
            value={ugx(m.netIncome)}
            sub={`Gross ${ugx(m.grossProfit)}`}
            accent
          />
        </div>
      </section>

      {/* Overall information */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Overall information
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Info
            icon={Users}
            label="Staff"
            value={num(activeStaff)}
            hint={
              staff.length > activeStaff ? `${staff.length - activeStaff} revoked` : "with a login"
            }
            to="/staff"
          />
          <Info icon={Users} label="Customers" value={num(customers.length)} to="/debtors" />
          <Info icon={Truck} label="Suppliers" value={num(suppliers.length)} to="/stock" />
          <Info
            icon={PackageX}
            label="Stopped / out-of-stock products"
            value={num(m.outOfStock.length)}
            to="/inventory"
          />
          <Info
            icon={PackageSearch}
            label="Low stock products"
            value={num(m.lowStock.length)}
            to="/inventory"
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="glass-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Sales & profit — last 7 days</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={m.days}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis
                  tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                />
                <Tooltip formatter={(v) => ugx(Number(v))} />
                <Bar dataKey="sales" name="Sales" fill="hsl(var(--chart-1, 220 70% 50%))" radius={[6, 6, 0, 0]} />
                <Bar dataKey="profit" name="Profit" fill="hsl(var(--chart-2, 150 60% 40%))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4" /> Expiry watchlist
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {m.expiring.length === 0 && (
              <p className="text-muted-foreground">Nothing expiring in the next 30 days.</p>
            )}
            {m.expiring.slice(0, 6).map(({ p, d }) => (
              <div key={p.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <Badge
                  className={
                    (d as number) < 0
                      ? "border-0 bg-destructive text-destructive-foreground"
                      : "border-0 bg-warning text-warning-foreground"
                  }
                >
                  {(d as number) < 0 ? `${Math.abs(d as number)}d expired` : `${d}d left`}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="glass-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="size-4" /> Recent sales
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.slice(0, 8).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap">{timeAgo(s.created_at)}</TableCell>
                    <TableCell>{s.customer_name ?? "Walk-in"}</TableCell>
                    <TableCell className="capitalize">{s.sale_type}</TableCell>
                    <TableCell>{paymentLabel(s.payment_method)}</TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {ugx(s.total_amount)}
                    </TableCell>
                  </TableRow>
                ))}
                {sales.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No sales recorded yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4" /> Latest stock movements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {movements.slice(0, 7).map((t) => {
              const p = products.find((x) => x.id === t.product_id);
              return (
                <div key={t.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{p?.name ?? "Product"}</span>
                  <span className="tabular text-xs text-muted-foreground">
                    {t.type.replace("_", " ")} · {num(t.quantity)}
                  </span>
                </div>
              );
            })}
            {movements.length === 0 && (
              <p className="text-muted-foreground">No stock movements yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Alert({ tone, text }: { tone: "warning" | "destructive"; text: string }) {
  return (
    <div
      className={
        tone === "destructive"
          ? "flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive"
          : "flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs font-semibold text-warning-foreground"
      }
    >
      <AlertTriangle className="size-3.5" />
      {text}
    </div>
  );
}

const TONES: Record<string, string> = {
  primary: "bg-primary/15 text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning-foreground",
  destructive: "bg-destructive/15 text-destructive",
};

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  onExpand,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone: keyof typeof TONES;
  /** When given, the tile opens the rows behind the figure. */
  onExpand?: () => void;
}) {
  const body = (
    <CardContent className="flex items-start gap-3 p-5">
      <span className={`flex size-11 items-center justify-center rounded-xl ${TONES[tone]}`}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="tabular truncate text-xl font-extrabold">{value}</p>
        <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
      </div>
      {onExpand && (
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </CardContent>
  );

  if (!onExpand) return <Card className="glass-card">{body}</Card>;

  return (
    <Card className="glass-card transition-shadow hover:shadow-[var(--shadow-card)]">
      <button
        type="button"
        onClick={onExpand}
        aria-label={`${label}: show the detail behind this figure`}
        className="w-full text-left"
      >
        {body}
      </button>
    </Card>
  );
}

function Mini({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <Card className={accent ? "glass-card border-success/40" : "glass-card"}>
      <CardContent className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className={`tabular truncate text-lg font-extrabold ${accent ? "text-success" : ""}`}>
          {value}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function Info({
  icon: Icon,
  label,
  value,
  hint,
  to,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  to: string;
}) {
  return (
    <Link to={to} className="block">
      <Card className="glass-card transition-shadow hover:shadow-[var(--shadow-card)]">
        <CardContent className="flex items-center gap-3 p-4">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="tabular text-lg font-extrabold leading-tight">{value}</p>
            <p className="truncate text-[11px] text-muted-foreground">{label}</p>
            {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
