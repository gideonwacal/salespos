/**
 * What is about to go out of date, and what it is worth.
 *
 * For a pharmacy, a clinic or a hospital this is a patient-safety list before
 * it is a money list: an expired strip on the shelf is one somebody can be
 * handed. For a supermarket it is the fresh counter, and the question is
 * whether to discount it today or write it off tomorrow.
 *
 * Batches are why it is a page rather than a column. Stock arrives in batches
 * with different dates, and the one being dispensed is the one nearest the
 * front — so the batch number sits next to every line here.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, PackageX, ShieldAlert } from "lucide-react";
import { useProducts, daysToExpiry } from "@/lib/data";
import { insertRows } from "@/lib/db";
import { useIndustry } from "@/hooks/useIndustry";
import { useAuth } from "@/hooks/useAuth";
import { isHealth } from "@/lib/industry";
import { ugx, num, shortDate } from "@/lib/format";
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

export const Route = createFileRoute("/_authenticated/expiry")({
  head: () => ({
    meta: [
      { title: "Expiry & batch watch — SalesPos" },
      {
        name: "description",
        content:
          "Everything nearing its expiry date, by batch, with what it is worth and one tap to write it off.",
      },
    ],
  }),
  component: ExpiryWatch,
});

/** The buckets people actually act on, in the order they act on them. */
const BANDS = [
  { id: "expired", label: "Already expired", within: -1 },
  { id: "week", label: "Within 7 days", within: 7 },
  { id: "month", label: "Within 30 days", within: 30 },
  { id: "quarter", label: "Within 90 days", within: 90 },
] as const;

function bandFor(days: number) {
  if (days < 0) return "expired";
  if (days <= 7) return "week";
  if (days <= 30) return "month";
  if (days <= 90) return "quarter";
  return "later";
}

function ExpiryWatch() {
  const industry = useIndustry();
  const { user, isOwner } = useAuth();
  const queryClient = useQueryClient();
  const { data: products = [] } = useProducts();
  const [busy, setBusy] = useState<string | null>(null);
  const clinical = isHealth(industry);

  const rows = useMemo(() => {
    return products
      .filter((p) => !p.is_service && p.expiry_date && Number(p.stock_quantity) > 0)
      .map((p) => {
        const days = daysToExpiry(p.expiry_date) ?? 0;
        return {
          product: p,
          days,
          band: bandFor(days),
          value: Number(p.unit_buying_price) * Number(p.stock_quantity),
        };
      })
      .filter((r) => r.band !== "later")
      .sort((a, b) => a.days - b.days);
  }, [products]);

  const totals = useMemo(
    () => ({
      lines: rows.length,
      units: rows.reduce((a, r) => a + Number(r.product.stock_quantity), 0),
      value: rows.reduce((a, r) => a + r.value, 0),
      expired: rows.filter((r) => r.band === "expired"),
    }),
    [rows],
  );

  /** Take it off the shelf and say why, in one action. */
  const writeOff = async (row: (typeof rows)[number]) => {
    const quantity = Number(row.product.stock_quantity);
    if (
      !window.confirm(
        `Write off all ${num(quantity)} of ${row.product.name}? This removes it from stock.`,
      )
    ) {
      return;
    }
    setBusy(row.product.id);
    try {
      await insertRows("damage_reports", {
        product_id: row.product.id,
        quantity,
        reason:
          row.days < 0
            ? `Expired ${shortDate(row.product.expiry_date ?? "")}`
            : `Written off before expiry ${shortDate(row.product.expiry_date ?? "")}`,
        reported_by: user?.id ?? null,
      });
      toast.success(`${row.product.name} written off`);
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not write that off");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Expiry &amp; batch watch</h1>
        <p className="text-sm text-muted-foreground">
          {clinical
            ? "Everything on the shelf with a date on it. Expired stock is a patient-safety matter before it is a cost — it should leave the shelf the day it turns."
            : "Everything with a date on it, soonest first. Discount it while it still sells, or write it off before it costs you twice."}
        </p>
      </div>

      {totals.expired.length > 0 && (
        <Card className="border-destructive shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
            <p className="flex items-center gap-2 font-semibold text-destructive">
              <ShieldAlert className="size-4" />
              {num(totals.expired.length)} line
              {totals.expired.length === 1 ? " is" : "s are"} already expired and still counted as
              stock
              {clinical ? " — take them off the shelf now." : "."}
            </p>
            <Badge className="border-0 bg-destructive text-destructive-foreground">
              {ugx(totals.expired.reduce((a, r) => a + r.value, 0))} at cost
            </Badge>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Lines to watch" value={num(totals.lines)} />
        <Tile label="Units affected" value={num(totals.units)} />
        <Tile label="Value at risk" value={ugx(totals.value)} tone="warning" />
      </div>

      {BANDS.map((band) => {
        const inBand = rows.filter((r) => r.band === band.id);
        if (!inBand.length) return null;
        return (
          <Card key={band.id} className="shadow-[var(--shadow-card)]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock
                  className={cn(
                    "size-4",
                    band.id === "expired" ? "text-destructive" : "text-warning-foreground",
                  )}
                />
                {band.label}
                <Badge variant="outline" className="ml-1 text-[10px]">
                  {num(inBand.length)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{industry.terms.product}</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">At cost</TableHead>
                    {isOwner && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inBand.map((r) => (
                    <TableRow
                      key={r.product.id}
                      className={cn(band.id === "expired" && "bg-destructive/5")}
                    >
                      <TableCell>
                        <p className="font-medium">{r.product.name}</p>
                        <p className="text-[11px] text-muted-foreground">{r.product.category}</p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.product.batch_number || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {shortDate(r.product.expiry_date ?? "")}
                        <span
                          className={cn(
                            "ml-1",
                            r.days < 0 ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {r.days < 0 ? `(${num(-r.days)}d ago)` : `(${num(r.days)}d)`}
                        </span>
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {num(r.product.stock_quantity)}
                      </TableCell>
                      <TableCell className="tabular text-right font-semibold">
                        {ugx(r.value)}
                      </TableCell>
                      {isOwner && (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={busy === r.product.id}
                            onClick={() => writeOff(r)}
                          >
                            <PackageX className="size-3.5" /> Write off
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}

      {rows.length === 0 && (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing on the shelf expires in the next 90 days.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={cn(
            "tabular mt-1 text-xl font-extrabold",
            tone === "warning" && "text-warning-foreground",
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
