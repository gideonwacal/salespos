import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useSales, useExpenses, useProducts } from "@/lib/data";
import { profitByCommodity } from "@/lib/profit";
import { ugx, num, shortDate, paymentLabel, PAYMENT_METHODS } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Letterhead } from "@/components/Letterhead";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
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
    // What the stock sold in this period cost to buy. Gross profit is the
    // revenue less this and nothing else; overheads come off after it.
    const buyingPrice = s.reduce((a, x) => a + Number(x.total_cost), 0);
    const overheads = e.reduce((a, x) => a + Number(x.amount), 0);
    const byMethod = PAYMENT_METHODS.map((m) => ({
      label: m.label,
      total: s
        .filter((x) => x.payment_method === m.value)
        .reduce((a, x) => a + Number(x.total_amount), 0),
    })).filter((r) => r.total > 0);
    const gross = revenue - buyingPrice;
    return {
      s,
      e,
      revenue,
      buyingPrice,
      gross,
      overheads,
      // Net profit is gross profit less the operating overheads.
      net: gross - overheads,
      byMethod,
    };
  }, [sales, expenses, from, to]);

  const stockValue = products.reduce(
    (a, p) => a + Number(p.unit_buying_price) * p.stock_quantity,
    0,
  );

  /**
   * The statement's gross profit, commodity by commodity, alongside the profit
   * still sitting on the shelf. The two are never added: one is money made in
   * this period, the other is money the stock would make if it all sold.
   */
  const perItem = useMemo(() => {
    const byItem = profitByCommodity(products, report.s);
    const rows = byItem.rows
      .filter((r) => r.soldQty > 0 || r.onHand > 0)
      .sort((a, b) => b.earned - a.earned || b.stockProfit - a.stockProfit);
    return { ...byItem, rows };
  }, [products, report.s]);

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
            <Row label="Buying price" value={`- ${ugx(report.buyingPrice)}`} />
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
          <CardTitle className="text-base">Gross profit by commodity</CardTitle>
          <p className="text-xs text-muted-foreground">
            Every item that sold in this period or is still in stock. Earned is what it sold for
            less the buying price of those units — the {ugx(report.gross)} gross profit above, split
            per item. In stock is what the units left on the shelf would make at the selling price
            less their buying price; nothing has been earned on those yet, so the two columns are
            never added together.
          </p>
        </CardHeader>
        <CardContent className="max-h-[28rem] overflow-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Gross revenue</TableHead>
                <TableHead className="text-right">Buying price</TableHead>
                <TableHead className="text-right">Earned</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">In stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perItem.rows.map((r) => (
                <TableRow key={r.productId}>
                  <TableCell>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-[11px] text-muted-foreground">{r.category}</p>
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {r.soldQty > 0 ? num(r.soldQty) : "—"}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {r.soldQty > 0 ? ugx(r.revenue) : "—"}
                  </TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {r.soldQty > 0 ? ugx(r.buyingPrice) : "—"}
                  </TableCell>
                  <TableCell
                    className={`tabular text-right font-semibold ${
                      r.earned > 0 ? "text-success" : r.earned < 0 ? "text-destructive" : ""
                    }`}
                  >
                    {r.soldQty > 0 ? ugx(r.earned) : "—"}
                  </TableCell>
                  <TableCell className="tabular text-right">{num(r.onHand)}</TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {r.onHand > 0 ? ugx(r.stockProfit) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {perItem.unattributed !== 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-xs text-muted-foreground">
                    Sales with no line items recorded, so they cannot be put against a commodity
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold">
                    {ugx(perItem.unattributed)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              )}
              {perItem.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    Nothing sold in this period and nothing is in stock.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell className="tabular text-right">
                  {num(perItem.rows.reduce((a, r) => a + r.soldQty, 0))}
                </TableCell>
                <TableCell className="tabular text-right">{ugx(perItem.revenue)}</TableCell>
                <TableCell className="tabular text-right">{ugx(perItem.buyingPrice)}</TableCell>
                <TableCell className="tabular text-right font-extrabold">
                  {ugx(perItem.earned + perItem.unattributed)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {num(perItem.rows.reduce((a, r) => a + r.onHand, 0))}
                </TableCell>
                <TableCell className="tabular text-right">
                  {ugx(perItem.rows.reduce((a, r) => a + r.stockProfit, 0))}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

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
