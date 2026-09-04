import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useSales, useExpenses, useProducts } from "@/lib/data";
import { ugx, shortDate, paymentLabel, PAYMENT_METHODS } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Letterhead } from "@/components/Letterhead";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports & P&L — SalesPos" },
      { name: "description", content: "End-of-day reconciliation and profit & loss statements for your business." },
      { property: "og:title", content: "Reports & P&L — SalesPos" },
      { property: "og:description", content: "End-of-day reconciliation and profit & loss statements for your business." },
    ],
  }),
  component: Reports,
});

function Reports() {
  const { data: sales = [] } = useSales();
  const { data: expenses = [] } = useExpenses();
  const { data: products = [] } = useProducts();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);

  const inRange = (iso: string) => {
    const d = iso.slice(0, 10);
    return d >= from && d <= to;
  };

  const report = useMemo(() => {
    const s = sales.filter((x) => inRange(x.created_at));
    const e = expenses.filter((x) => inRange(x.expense_date));
    const revenue = s.reduce((a, x) => a + Number(x.total_amount), 0);
    const cogs = s.reduce((a, x) => a + Number(x.total_cost), 0);
    const overheads = e.reduce((a, x) => a + Number(x.amount), 0);
    const byMethod = PAYMENT_METHODS.map((m) => ({
      label: m.label,
      total: s
        .filter((x) => x.payment_method === m.value)
        .reduce((a, x) => a + Number(x.total_amount), 0),
    })).filter((r) => r.total > 0);
    return {
      s,
      e,
      revenue,
      cogs,
      gross: revenue - cogs,
      overheads,
      net: revenue - cogs - overheads,
      byMethod,
    };
  }, [sales, expenses, from, to]);

  const stockValue = products.reduce(
    (a, p) => a + Number(p.unit_buying_price) * p.stock_quantity,
    0,
  );

  return (
    <div className="space-y-4">
      <Letterhead
        title="End-of-day statement"
        subtitle={`${shortDate(from)} — ${shortDate(to)}`}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Reports & profit / loss</h1>
          <p className="text-sm text-muted-foreground">
            {shortDate(from)} — {shortDate(to)}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => window.print()}>
            Print statement
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-base">Profit & loss statement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Gross revenue" value={ugx(report.revenue)} />
            <Row label="Cost of goods sold" value={`- ${ugx(report.cogs)}`} />
            <Row label="Gross profit" value={ugx(report.gross)} strong />
            <Row label="Operating overheads" value={`- ${ugx(report.overheads)}`} />
            <div className="flex items-center justify-between rounded-lg bg-success-soft px-3 py-2">
              <span className="font-semibold">Net profit</span>
              <span className="tabular text-lg font-extrabold text-success">
                {ugx(report.net)}
              </span>
            </div>
            <Row label="Closing stock valuation" value={ugx(stockValue)} />
          </CardContent>
        </Card>

        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-base">Cash reconciliation by payment method</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {report.byMethod.map((m) => (
              <Row key={m.label} label={m.label} value={ugx(m.total)} />
            ))}
            {report.byMethod.length === 0 && (
              <p className="text-muted-foreground">No sales in this period.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">Sales in period ({report.s.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.s.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{shortDate(s.created_at)}</TableCell>
                  <TableCell>{s.customer_name ?? "Walk-in"}</TableCell>
                  <TableCell className="capitalize">{s.sale_type}</TableCell>
                  <TableCell>{paymentLabel(s.payment_method)}</TableCell>
                  <TableCell className="tabular text-right text-success">
                    {ugx(Number(s.total_amount) - Number(s.total_cost))}
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold">
                    {ugx(s.total_amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0">
      <span className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </div>
  );
}
