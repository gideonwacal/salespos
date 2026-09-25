/**
 * Counting the shelf, and making the system agree with it.
 *
 * Every trade here does this — a pharmacy counts strips, a hardware store
 * counts bags of cement, a supermarket cycles a department a week — and until
 * now the only way to correct a count was to edit the number, which leaves no
 * trace of why it moved. This files the difference as an adjustment instead,
 * so the movement ledger still explains every unit.
 *
 * Nothing is written until the count is submitted, and only rows that actually
 * differ are written at all: a stock take where nothing moved should leave no
 * mark on the ledger.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, Search, TriangleAlert } from "lucide-react";
import { useProducts } from "@/lib/data";
import { insertRows } from "@/lib/db";
import { useIndustry } from "@/hooks/useIndustry";
import { useAuth } from "@/hooks/useAuth";
import { ugx, num } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/stocktake")({
  head: () => ({
    meta: [
      { title: "Stock take — SalesPos" },
      {
        name: "description",
        content:
          "Count what is actually on the shelf and file the differences, with every correction left in the stock ledger.",
      },
    ],
  }),
  component: StockTake,
});

function StockTake() {
  const industry = useIndustry();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: products = [] } = useProducts();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      // A service has no shelf to count.
      .filter((p) => !p.is_service)
      .filter((p) => category === "all" || p.category === category)
      .filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [products, query, category]);

  /** Only the rows somebody actually typed a number into, and only the ones that differ. */
  const variances = useMemo(() => {
    return products
      .map((p) => {
        const typed = counted[p.id];
        if (typed === undefined || typed.trim() === "") return null;
        const count = Number(typed);
        if (!Number.isFinite(count) || count < 0) return null;
        const delta = count - Number(p.stock_quantity);
        if (delta === 0) return null;
        return { product: p, count, delta, value: delta * Number(p.unit_buying_price) };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
  }, [products, counted]);

  const shortfall = variances.filter((v) => v.delta < 0);
  const netValue = variances.reduce((a, v) => a + v.value, 0);

  const file = async () => {
    if (!variances.length) return;
    setBusy(true);
    let done = 0;
    try {
      for (const v of variances) {
        // An adjustment carries its own sign: positive puts stock on, negative
        // takes it off. The note is what makes the ledger readable in a year.
        await insertRows("stock_transactions", {
          product_id: v.product.id,
          type: "adjustment",
          quantity: v.delta,
          notes: `Stock take: system ${v.product.stock_quantity}, counted ${v.count}`,
          expiry_date: null,
          performed_by: user?.id ?? null,
        });
        done += 1;
      }
      toast.success(`${done} correction${done === 1 ? "" : "s"} filed`);
      setCounted({});
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not file the corrections", {
        description: done ? `${done} were saved before it stopped.` : undefined,
      });
      queryClient.invalidateQueries();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Stock take</h1>
          <p className="text-sm text-muted-foreground">
            Count what is on the shelf, type it in, and file only what differs. Every correction
            is left in the stock ledger with the numbers behind it.
          </p>
        </div>
        <Button disabled={!variances.length || busy} onClick={file}>
          <ClipboardList className="size-4" />
          {busy
            ? "Filing…"
            : variances.length
              ? `File ${variances.length} difference${variances.length === 1 ? "" : "s"}`
              : "Nothing to file"}
        </Button>
      </div>

      {variances.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="Counted so far" value={num(Object.keys(counted).length)} />
          <Tile
            label="Lines short"
            value={num(shortfall.length)}
            tone={shortfall.length ? "danger" : undefined}
          />
          <Tile
            label="Net value change"
            value={ugx(netValue)}
            tone={netValue < 0 ? "danger" : "success"}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={`Search ${industry.terms.products.toLowerCase()}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All {industry.terms.category.toLowerCase()}s</SelectItem>
            {industry.categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{industry.terms.product}</TableHead>
                <TableHead className="text-right">System says</TableHead>
                <TableHead className="w-[140px] text-right">Counted</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead className="text-right">At cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const typed = counted[p.id] ?? "";
                const count = typed.trim() === "" ? null : Number(typed);
                const delta =
                  count === null || !Number.isFinite(count)
                    ? null
                    : count - Number(p.stock_quantity);
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {[p.category, p.batch_number].filter(Boolean).join(" · ")}
                      </p>
                    </TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">
                      {num(p.stock_quantity)}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className="h-8 text-right"
                        value={typed}
                        onChange={(e) =>
                          setCounted((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                      />
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular text-right font-semibold",
                        delta !== null && delta < 0 && "text-destructive",
                        delta !== null && delta > 0 && "text-success",
                      )}
                    >
                      {delta === null ? "—" : delta > 0 ? `+${num(delta)}` : num(delta)}
                    </TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">
                      {delta === null || delta === 0
                        ? "—"
                        : ugx(delta * Number(p.unit_buying_price))}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Nothing to count here.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {shortfall.length > 0 && (
        <Card className="border-destructive/40 shadow-[var(--shadow-card)]">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <TriangleAlert className="size-4" /> Short on {num(shortfall.length)} line
              {shortfall.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {shortfall.slice(0, 8).map((v) => (
              <div key={v.product.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{v.product.name}</span>
                <span className="tabular shrink-0 font-semibold text-destructive">
                  {num(v.delta)} · {ugx(v.value)}
                </span>
              </div>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">
              Stock that is short with no damage report behind it is the number worth asking
              about.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
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
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={cn(
            "tabular mt-1 text-xl font-extrabold",
            tone === "danger" && "text-destructive",
            tone === "success" && "text-success",
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
