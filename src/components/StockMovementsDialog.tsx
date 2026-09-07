/**
 * Stock available and how it got that way, over a period the owner chooses.
 *
 * The dashboard tile shows the last seven movements, which answers "is anything
 * happening?" and nothing else. The question behind it is always seasonal —
 * what went out last month, which lines are draining, what did we take in — so
 * this opens the same ledger as a chart with a date range and a product search
 * behind it.
 *
 * Each bucket carries a pair of bars, stock in beside stock out, so a month
 * where the shelf emptied looks different at a glance from one where it
 * filled. Buckets switch from days to months once the range is longer than
 * about two months, because 200 daily bars is a smear, not a chart.
 */

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownUp, Boxes, PackageSearch, Search } from "lucide-react";
import { type Product, type StockTxn } from "@/lib/data";
import { num, shortDate, ugx } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Movement types that put stock on the shelf; everything else takes it off. */
const INBOUND = new Set(["stock_in", "adjustment"]);

const iso = (d: Date) => d.toISOString().slice(0, 10);

function startOfMonth(offset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return iso(d);
}

function endOfMonth(offset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset + 1);
  d.setDate(0);
  return iso(d);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}

export function StockMovementsDialog({
  open,
  onClose,
  movements,
  products,
}: {
  open: boolean;
  onClose: () => void;
  movements: StockTxn[];
  products: Product[];
}) {
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(iso(new Date()));
  const [query, setQuery] = useState("");

  const productName = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p.name]));
    return (txn: StockTxn) =>
      // The API nests the name on the row; locally stored movements carry only
      // the id, so fall back to the product list either way.
      String((txn as { product_name?: string }).product_name ?? "") ||
      byId.get(txn.product_id) ||
      "Unknown product";
  }, [products]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return movements
      .map((t) => ({ txn: t, name: productName(t), day: String(t.created_at).slice(0, 10) }))
      .filter((r) => r.day >= from && r.day <= to)
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => b.day.localeCompare(a.day));
  }, [movements, productName, from, to, query]);

  /** Day buckets for a short range, month buckets for a long one. */
  const byMonth = useMemo(() => {
    const span = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
    return span > 62;
  }, [from, to]);

  const chart = useMemo(() => {
    const buckets = new Map<string, { key: string; label: string; in: number; out: number }>();
    for (const r of rows) {
      const key = byMonth ? r.day.slice(0, 7) : r.day;
      const label = byMonth
        ? new Date(`${key}-01T00:00:00`).toLocaleDateString("en-GB", {
            month: "short",
            year: "2-digit",
          })
        : new Date(`${r.day}T00:00:00`).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          });
      const bucket = buckets.get(key) ?? { key, label, in: 0, out: 0 };
      const qty = Math.abs(Number(r.txn.quantity) || 0);
      if (INBOUND.has(r.txn.type)) bucket.in += qty;
      else bucket.out += qty;
      buckets.set(key, bucket);
    }
    return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [rows, byMonth]);

  /** Per product: what moved in the period, and what is on the shelf now. */
  const perProduct = useMemo(() => {
    const map = new Map<string, { id: string; name: string; in: number; out: number }>();
    for (const r of rows) {
      const id = r.txn.product_id;
      const row = map.get(id) ?? { id, name: r.name, in: 0, out: 0 };
      const qty = Math.abs(Number(r.txn.quantity) || 0);
      if (INBOUND.has(r.txn.type)) row.in += qty;
      else row.out += qty;
      map.set(id, row);
    }
    return [...map.values()]
      .map((row) => {
        const product = products.find((p) => p.id === row.id);
        return {
          ...row,
          onHand: Number(product?.stock_quantity ?? 0),
          reorder: Number(product?.reorder_level ?? 0),
          value: Number(product?.unit_buying_price ?? 0) * Number(product?.stock_quantity ?? 0),
        };
      })
      .sort((a, b) => b.out - a.out);
  }, [rows, products]);

  const totals = useMemo(
    () => ({
      in: chart.reduce((a, b) => a + b.in, 0),
      out: chart.reduce((a, b) => a + b.out, 0),
      onHand: products.reduce((a, p) => a + Number(p.stock_quantity), 0),
      value: products.reduce(
        (a, p) => a + Number(p.unit_buying_price) * Number(p.stock_quantity),
        0,
      ),
    }),
    [chart, products],
  );

  const setRange = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowDownUp className="size-4" /> Stock available &amp; movements
          </DialogTitle>
          <DialogDescription>
            {shortDate(from)} — {shortDate(to)} · {num(rows.length)} movement
            {rows.length === 1 ? "" : "s"}
            {query && ` matching “${query}”`}
          </DialogDescription>
        </DialogHeader>

        {/* period search */}
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                className="h-9 w-[150px]"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                className="h-9 w-[150px]"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="relative min-w-[200px] flex-1 space-y-1.5">
              <Label className="text-xs">Product</Label>
              <Search className="absolute left-3 top-[30px] size-4 text-muted-foreground" />
              <Input
                className="h-9 pl-9"
                placeholder="Search a product"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Quick label="Last 7 days" onClick={() => setRange(daysAgo(6), iso(new Date()))} />
            <Quick label="Last 30 days" onClick={() => setRange(daysAgo(29), iso(new Date()))} />
            <Quick label="This month" onClick={() => setRange(startOfMonth(), iso(new Date()))} />
            <Quick label="Last month" onClick={() => setRange(startOfMonth(-1), endOfMonth(-1))} />
            <Quick
              label="This year"
              onClick={() => setRange(`${new Date().getFullYear()}-01-01`, iso(new Date()))}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Tile label="Stock in" value={num(totals.in)} tone="success" />
          <Tile label="Stock out" value={num(totals.out)} tone="danger" />
          <Tile label="On the shelf now" value={num(totals.onHand)} />
          <Tile label="Stock value" value={ugx(totals.value)} />
        </div>

        <div className="h-64">
          {chart.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              No stock moved in this period.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} />
                <Tooltip formatter={(v, n) => [num(Number(v)), n]} />
                <Legend />
                <Bar
                  dataKey="in"
                  name="Stock in"
                  fill="hsl(var(--chart-2, 150 60% 40%))"
                  radius={[6, 6, 0, 0]}
                />
                <Bar
                  dataKey="out"
                  name="Stock out"
                  fill="hsl(var(--chart-1, 220 70% 50%))"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <Tabs defaultValue="products">
          <TabsList>
            <TabsTrigger value="products">
              <Boxes className="size-3.5" /> By product
            </TabsTrigger>
            <TabsTrigger value="ledger">
              <PackageSearch className="size-3.5" /> Every movement
            </TabsTrigger>
          </TabsList>

          <TabsContent value="products" className="pt-3">
            <div className="max-h-72 overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">In</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                    <TableHead className="text-right">Available now</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perProduct.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="max-w-[260px] truncate">{row.name}</TableCell>
                      <TableCell className="tabular text-right text-success">
                        {row.in ? `+${num(row.in)}` : "—"}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {row.out ? `-${num(row.out)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="tabular font-semibold">{num(row.onHand)}</span>
                        {row.onHand <= row.reorder && (
                          <Badge className="ml-2 border-0 bg-warning text-warning-foreground text-[10px]">
                            low
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {perProduct.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        Nothing moved in this period.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="ledger" className="pt-3">
            <div className="max-h-72 overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 200).map((r) => (
                    <TableRow key={r.txn.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {shortDate(r.day)}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate">{r.name}</TableCell>
                      <TableCell className="capitalize text-xs">
                        {r.txn.type.replace("_", " ")}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular text-right font-semibold",
                          INBOUND.has(r.txn.type) ? "text-success" : "text-muted-foreground",
                        )}
                      >
                        {INBOUND.has(r.txn.type) ? "+" : "-"}
                        {num(Math.abs(Number(r.txn.quantity)))}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                        {r.txn.notes || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        No movements in this period.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {rows.length > 200 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Showing the first 200 of {num(rows.length)} — narrow the dates, or export the full
                  period from Import &amp; export.
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Quick({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClick}>
      {label}
    </Button>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="p-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={cn(
            "tabular mt-0.5 text-lg font-extrabold",
            tone === "success" && "text-success",
            tone === "danger" && "text-destructive",
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
