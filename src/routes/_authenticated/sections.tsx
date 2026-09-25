/**
 * Which part of the business actually earns.
 *
 * A supermarket owner wants it by department, a pharmacy by drug class, a
 * hardware store by section — the same question in three vocabularies, which
 * is why the page takes its heading from the industry profile rather than
 * naming one trade.
 *
 * Worked out from the sale lines rather than a stored total, so it is right
 * whatever anyone has been editing: every line knows its product, and every
 * product knows its section.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Layers, TrendingDown, TrendingUp } from "lucide-react";
import { useProducts, useSales } from "@/lib/data";
import { saleLines } from "@/lib/db";
import { useIndustry } from "@/hooks/useIndustry";
import { ugx, num } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/sections")({
  head: () => ({
    meta: [
      { title: "Takings by section — SalesPos" },
      {
        name: "description",
        content:
          "What each department, section or drug class sold, what it cost and what it earned.",
      },
    ],
  }),
  component: Sections,
});

const RANGES = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "all", label: "All time", days: 0 },
] as const;

function Sections() {
  const industry = useIndustry();
  const { data: sales = [] } = useSales();
  const { data: products = [] } = useProducts();
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("30");

  const sectionOf = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p.category]));
    return (productId: string) => byId.get(productId) ?? "Uncategorised";
  }, [products]);

  const rows = useMemo(() => {
    const chosen = RANGES.find((r) => r.id === range)!;
    const since = chosen.days
      ? Date.now() - chosen.days * 86400000
      : Number.NEGATIVE_INFINITY;

    const totals = new Map<
      string,
      { section: string; revenue: number; cost: number; units: number; lines: number }
    >();

    for (const sale of sales) {
      if (new Date(sale.created_at).getTime() < since) continue;
      for (const line of saleLines(sale)) {
        const section = sectionOf(line.product_id);
        const row =
          totals.get(section) ??
          { section, revenue: 0, cost: 0, units: 0, lines: 0 };
        row.revenue += Number(line.unit_price) * Number(line.quantity);
        row.cost += Number(line.unit_cost) * Number(line.quantity);
        row.units += Number(line.quantity);
        row.lines += 1;
        totals.set(section, row);
      }
    }

    return [...totals.values()]
      .map((r) => ({
        ...r,
        profit: r.revenue - r.cost,
        // Margin on zero revenue is not zero, it is undefined; showing 0%
        // would read as "sold at cost" rather than "sold nothing".
        margin: r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : null,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [sales, sectionOf, range]);

  const grand = rows.reduce(
    (a, r) => ({ revenue: a.revenue + r.revenue, profit: a.profit + r.profit }),
    { revenue: 0, profit: 0 },
  );

  /** Sections in the profile that sold nothing at all — the quiet half of the shop. */
  const silent = useMemo(
    () => industry.categories.filter((c) => !rows.some((r) => r.section === c)),
    [industry.categories, rows],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Takings by {industry.terms.category.toLowerCase()}</h1>
          <p className="text-sm text-muted-foreground">
            What each {industry.terms.category.toLowerCase()} sold, what it cost you, and what it
            actually left behind.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RANGES.map((r) => (
            <Button
              key={r.id}
              size="sm"
              variant={range === r.id ? "default" : "outline"}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Revenue" value={ugx(grand.revenue)} />
        <Tile label="Gross profit" value={ugx(grand.profit)} tone="success" />
        <Tile
          label={`${industry.terms.category}s selling`}
          value={`${num(rows.length)} of ${num(rows.length + silent.length)}`}
        />
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="size-4" /> {industry.terms.category} by takings
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{industry.terms.category}</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const share = grand.revenue > 0 ? (r.revenue / grand.revenue) * 100 : 0;
                const thin = r.margin !== null && r.margin < 10;
                return (
                  <TableRow key={r.section}>
                    <TableCell className="font-medium">{r.section}</TableCell>
                    <TableCell className="tabular text-right">{num(r.units)}</TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {ugx(r.revenue)}
                    </TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">
                      {ugx(r.cost)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular text-right font-semibold",
                        r.profit < 0 && "text-destructive",
                      )}
                    >
                      {ugx(r.profit)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.margin === null ? (
                        "—"
                      ) : (
                        <span
                          className={cn(
                            "tabular inline-flex items-center gap-1",
                            thin && "text-warning-foreground",
                            r.margin < 0 && "text-destructive",
                          )}
                        >
                          {r.margin < 0 ? (
                            <TrendingDown className="size-3" />
                          ) : (
                            <TrendingUp className="size-3" />
                          )}
                          {r.margin.toFixed(1)}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="tabular text-xs text-muted-foreground">
                          {share.toFixed(0)}%
                        </span>
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(100, share)}%` }}
                          />
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    Nothing sold in this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {silent.length > 0 && rows.length > 0 && (
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Sold nothing in this period
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Stock sitting in these is money doing nothing. Worth knowing before the next
              delivery.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {silent.map((c) => (
              <Badge key={c} variant="outline" className="text-[11px]">
                {c}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn("tabular mt-1 text-xl font-extrabold", tone === "success" && "text-success")}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
