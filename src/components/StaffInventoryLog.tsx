/**
 * What the counter put into the store, and who put it there.
 *
 * The owner is answerable for the stock list but rarely types it in. Three
 * different acts land in inventory — a new item on the price list, a delivery
 * received, damage written off — and each one moves money without a sale. This
 * is the owner's window onto all three, per person, so an item priced wrong or
 * a write-off nobody mentioned is visible from the dashboard rather than found
 * during a stock take.
 *
 * Read-only on purpose. Deleting stock is the owner's own act, and it lives on
 * the inventory page next to the item it removes.
 */

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ClipboardList, PackagePlus, PackageX, Search, Tag } from "lucide-react";
import { type DamageReport, type Product, type StockTxn } from "@/lib/data";
import { staffUserId, type StaffRow } from "@/lib/db";
import { num, shortDate, ugx } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

/** Anything a member of staff did to the store, flattened into one shape. */
type Entry = {
  id: string;
  kind: "item" | "received" | "damage";
  when: string;
  product: string;
  who: string;
  quantity: number;
  /** What it was worth at cost, where that can be worked out. */
  value: number;
  note: string;
};

export function StaffInventoryLog({
  products,
  movements,
  damages,
  staff,
}: {
  products: Product[];
  movements: StockTxn[];
  damages: DamageReport[];
  staff: StaffRow[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const nameFor = useMemo(() => {
    const byId = new Map(staff.map((s) => [staffUserId(s), s.full_name || s.email]));
    return (id: string | null | undefined) =>
      id ? (byId.get(id) ?? "Removed user") : "Not recorded";
  }, [staff]);

  const productFor = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    return (id: string) => byId.get(id);
  }, [products]);

  const entries = useMemo<Entry[]>(() => {
    const items: Entry[] = products.map((p) => ({
      id: `item-${p.id}`,
      kind: "item",
      when: p.created_at,
      product: p.name,
      who: p.created_by_name || nameFor(p.created_by),
      quantity: Number(p.stock_quantity),
      value: Number(p.unit_buying_price) * Number(p.stock_quantity),
      note: `${p.category} · buys at ${ugx(p.unit_buying_price)}, sells at ${ugx(p.unit_selling_price)}`,
    }));

    const received: Entry[] = movements
      .filter((t) => t.type === "stock_in" || t.type === "adjustment")
      .map((t) => {
        const p = productFor(t.product_id);
        return {
          id: `move-${t.id}`,
          kind: "received",
          when: t.created_at,
          product: (t as { product_name?: string }).product_name || p?.name || "Unknown product",
          who: nameFor(t.performed_by),
          quantity: Number(t.quantity),
          value: Number(p?.unit_buying_price ?? 0) * Math.abs(Number(t.quantity)),
          note: t.notes || (t.type === "adjustment" ? "Adjustment" : "Stock arrival"),
        };
      });

    const written: Entry[] = damages.map((d) => {
      const p = productFor(d.product_id);
      return {
        id: `damage-${d.id}`,
        kind: "damage",
        when: d.created_at,
        product: p?.name ?? "Unknown product",
        who: nameFor(d.reported_by),
        quantity: -Math.abs(Number(d.quantity)),
        value: Number(p?.unit_buying_price ?? 0) * Math.abs(Number(d.quantity)),
        note: d.reason || "Damaged goods",
      };
    });

    return [...items, ...received, ...written].sort((a, b) =>
      String(b.when).localeCompare(String(a.when)),
    );
  }, [products, movements, damages, nameFor, productFor]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.product.toLowerCase().includes(q) ||
        e.who.toLowerCase().includes(q) ||
        e.note.toLowerCase().includes(q),
    );
  }, [entries, query]);

  /** Per person, so one glance says who has been touching the store. */
  const byPerson = useMemo(() => {
    const map = new Map<
      string,
      { who: string; items: number; received: number; damages: number; value: number; last: string }
    >();
    for (const e of entries) {
      const row = map.get(e.who) ?? {
        who: e.who,
        items: 0,
        received: 0,
        damages: 0,
        value: 0,
        last: "",
      };
      if (e.kind === "item") row.items += 1;
      if (e.kind === "received") row.received += 1;
      if (e.kind === "damage") row.damages += 1;
      row.value += e.value;
      if (String(e.when) > row.last) row.last = String(e.when);
      map.set(e.who, row);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [entries]);

  const recent = entries.slice(0, 4);

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="glass-card cursor-pointer transition-shadow hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="size-4" /> Stock added by staff
            <span className="ml-auto text-[11px] font-normal text-muted-foreground">
              Tap to review
            </span>
          </CardTitle>
          <CardDescription>
            {num(entries.length)} entr{entries.length === 1 ? "y" : "ies"} across{" "}
            {num(byPerson.length)} {byPerson.length === 1 ? "person" : "people"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {recent.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{e.product}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{e.who}</span>
            </div>
          ))}
          {entries.length === 0 && (
            <p className="text-muted-foreground">Nothing has been added yet.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="size-4" /> Stock added by staff
            </DialogTitle>
            <DialogDescription>
              New items on the price list, deliveries received and damage written off — with the
              person who recorded each one.
            </DialogDescription>
          </DialogHeader>

          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search a product, a person or a note"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <Tabs defaultValue="entries">
            <TabsList>
              <TabsTrigger value="entries">Everything added</TabsTrigger>
              <TabsTrigger value="people">By person</TabsTrigger>
            </TabsList>

            <TabsContent value="entries" className="pt-3">
              <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>What</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">At cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.slice(0, 200).map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {shortDate(e.when)}
                        </TableCell>
                        <TableCell>
                          <Kind kind={e.kind} />
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <p className="truncate font-medium">{e.product}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{e.note}</p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{e.who}</TableCell>
                        <TableCell className="tabular text-right">
                          {e.quantity > 0 ? `+${num(e.quantity)}` : num(e.quantity)}
                        </TableCell>
                        <TableCell className="tabular text-right font-semibold">
                          {ugx(e.value)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          {entries.length === 0
                            ? "Nothing has been added to the store yet."
                            : "Nothing matches that search."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {filtered.length > 200 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    Showing the 200 most recent of {num(filtered.length)}.
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="people" className="pt-3">
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead className="text-right">New items</TableHead>
                      <TableHead className="text-right">Deliveries</TableHead>
                      <TableHead className="text-right">Damages</TableHead>
                      <TableHead className="text-right">Value handled</TableHead>
                      <TableHead className="text-right">Last entry</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byPerson.map((row) => (
                      <TableRow key={row.who}>
                        <TableCell className="font-medium">{row.who}</TableCell>
                        <TableCell className="tabular text-right">{num(row.items)}</TableCell>
                        <TableCell className="tabular text-right">{num(row.received)}</TableCell>
                        <TableCell className="tabular text-right">
                          {row.damages ? (
                            <span className="font-semibold text-destructive">
                              {num(row.damages)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="tabular text-right font-semibold">
                          {ugx(row.value)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {row.last ? shortDate(row.last) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {byPerson.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          Nobody has added stock yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm">
              <Link to="/inventory" onClick={() => setOpen(false)}>
                Open inventory <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Kind({ kind }: { kind: Entry["kind"] }) {
  if (kind === "item") {
    return (
      <Badge variant="outline" className="gap-1 text-[10px]">
        <Tag className="size-3" /> New item
      </Badge>
    );
  }
  if (kind === "received") {
    return (
      <Badge variant="outline" className="gap-1 border-success/50 text-[10px] text-success">
        <PackagePlus className="size-3" /> Received
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-destructive/50 text-[10px] text-destructive">
      <PackageX className="size-3" /> Damage
    </Badge>
  );
}
