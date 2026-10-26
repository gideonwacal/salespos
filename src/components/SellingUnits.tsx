import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { deleteRow, insertRows, updateRow } from "@/lib/db";
import { type Product, type ProductUnit } from "@/lib/data";
import { ugx } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

/** The sizes a shop is likely to want, so nobody types 0.25 by hand. */
const PRESETS: { name: string; factor: number }[] = [
  { name: "1/4 kg", factor: 0.25 },
  { name: "1/2 kg", factor: 0.5 },
  { name: "3/4 kg", factor: 0.75 },
  { name: "1 kg", factor: 1 },
  { name: "2 kg", factor: 2 },
  { name: "5 kg", factor: 5 },
  { name: "25kg bag", factor: 25 },
  { name: "50kg sack", factor: 50 },
  { name: "Crate of 24", factor: 24 },
  { name: "Carton of 12", factor: 12 },
];

type Draft = { name: string; factor: string; price: string };

const EMPTY: Draft = { name: "", factor: "", price: "" };

export function SellingUnits({
  product,
  units,
  onOpenChange,
}: {
  product: Product | null;
  units: ProductUnit[];
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(EMPTY);
  }, [product?.id]);

  if (!product) return null;

  const base = product.unit_of_measure || "unit";
  const mine = units
    .filter((u) => u.product === product.id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.factor - b.factor);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["product_units"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const add = async () => {
    const name = draft.name.trim();
    const factor = Number(draft.factor);
    const price = Number(draft.price);

    if (!name) return toast.error("Give the size a name, like “1/4 kg”");
    if (!Number.isFinite(factor) || factor <= 0)
      return toast.error(`How many ${base} is one of these? It has to be more than zero.`);
    if (!Number.isFinite(price) || price <= 0) return toast.error("Enter what this size sells for");
    if (mine.some((u) => u.name.toLowerCase() === name.toLowerCase()))
      return toast.error(`${product.name} already has a “${name}”`);

    setBusy(true);
    try {
      await insertRows("product_units", {
        product: product.id,
        name,
        factor,
        price,
        // The first size added is the one the till offers first, until the
        // owner says otherwise.
        is_default: mine.length === 0,
        sort_order: mine.length,
      });
      setDraft(EMPTY);
      refresh();
      toast.success(`${name} added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add that size");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (unit: ProductUnit) => {
    try {
      await deleteRow("product_units", unit.id);
      refresh();
      toast.success(`${unit.name} removed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove that size");
    }
  };

  const makeDefault = async (unit: ProductUnit) => {
    try {
      await updateRow("product_units", unit.id, { is_default: true });
      for (const other of mine) {
        if (other.id !== unit.id && other.is_default) {
          await updateRow("product_units", other.id, { is_default: false });
        }
      }
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the default");
    }
  };

  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Selling sizes — {product.name}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Stock is held in <span className="font-semibold">{base}</span>. Add the sizes
          you actually sell, each with its own price — a quarter is usually dearer than
          a quarter of the kilo price, and that difference is yours to keep.
        </p>

        {mine.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {mine.map((u) => (
              <li key={u.id} className="flex items-center gap-2 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {u.name}{" "}
                    {u.is_default && (
                      <Badge variant="secondary" className="ml-1 text-[10px]">
                        first choice
                      </Badge>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {u.factor} {base} · {ugx(Number(u.price))}
                    {/* What the shop makes by breaking bulk, said plainly. */}
                    {u.factor !== 1 && product.unit_selling_price > 0 && (
                      <>
                        {" · "}
                        {Number(u.price) > product.unit_selling_price * u.factor
                          ? `${ugx(
                              Number(u.price) - product.unit_selling_price * u.factor,
                            )} over the ${base} rate`
                          : "at the straight rate"}
                      </>
                    )}
                  </p>
                </div>
                {!u.is_default && (
                  <Button size="sm" variant="ghost" onClick={() => makeDefault(u)}>
                    Make first
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-destructive"
                  onClick={() => remove(u)}
                  title="Remove this size"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.filter((p) => !mine.some((u) => u.name === p.name)).map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, name: p.name, factor: String(p.factor) }))}
                className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                {p.name}
              </button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                placeholder="1/4 kg"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">How many {base}</Label>
              <Input
                inputMode="decimal"
                placeholder="0.25"
                value={draft.factor}
                onChange={(e) => setDraft({ ...draft, factor: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sells for</Label>
              <Input
                inputMode="decimal"
                placeholder="1200"
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              />
            </div>
          </div>

          <Button onClick={add} disabled={busy} className="w-full">
            <Plus className="mr-2 size-4" />
            Add this size
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
