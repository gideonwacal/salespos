import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Minus, PencilLine, Plus, Trash2 } from "lucide-react";
import { useSales, type Sale, type SaleLine } from "@/lib/data";
import { amendSaleRows, deleteRow, saleLines } from "@/lib/db";
import { ugx, paymentLabel } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The last few sales, with a way to put one right.
 *
 * The counter mis-keys sales, and the cashier who made the mistake is the one
 * standing there when the customer points it out. Correcting a sale is
 * therefore open to staff; voiding one — which erases it — stays with the owner.
 */
export function RecentSales({ limit = 8 }: { limit?: number }) {
  const { data: sales = [] } = useSales();
  const { isOwner } = useAuth();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<Sale | null>(null);
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [busy, setBusy] = useState(false);

  const recent = [...sales]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);

  const openFix = (sale: Sale) => {
    const existing = saleLines(sale);
    if (!existing.length) {
      toast.error("That sale has no line items to correct");
      return;
    }
    setEditing(sale);
    setLines(existing);
  };

  const setQty = (productId: string, quantity: number) =>
    setLines((prev) =>
      prev.map((l) => (l.product_id === productId ? { ...l, quantity } : l)),
    );

  const removeLine = (productId: string) =>
    setLines((prev) => prev.filter((l) => l.product_id !== productId));

  const newTotal = lines.reduce((a, l) => a + l.unit_price * l.quantity, 0);

  const save = async () => {
    if (!editing) return;
    const kept = lines.filter((l) => l.quantity > 0);
    if (!kept.length) {
      toast.error("A sale needs at least one item — void it instead");
      return;
    }

    setBusy(true);
    try {
      await amendSaleRows(editing.id, {
        sale_type: editing.sale_type,
        payment_method: editing.payment_method,
        customer_name: editing.customer_name,
        lines: kept.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
          unit_cost: l.unit_cost,
          subtotal: l.unit_price * l.quantity,
        })),
      });
      toast.success("Sale corrected — stock has been adjusted");
      setEditing(null);
      // Stock moved, so the product grid and the totals both need re-reading.
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not correct the sale");
    } finally {
      setBusy(false);
    }
  };

  const voidSale = async (sale: Sale) => {
    if (!window.confirm("Void this sale? The stock goes back and the sale is erased.")) {
      return;
    }
    try {
      await deleteRow("sales", sale.id);
      toast.success("Sale voided and stock returned");
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not void the sale");
    }
  };

  return (
    <>
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">Recent sales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recent.length === 0 && (
            <p className="text-sm text-muted-foreground">No sales rung up yet today.</p>
          )}

          {recent.map((sale) => (
            <div
              key={sale.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {ugx(sale.total_amount)}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {sale.customer_name || "Walk-in"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(sale.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {paymentLabel(sale.payment_method)}
                  {sale.sale_type === "wholesale" && " · wholesale"}
                </p>
              </div>

              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => openFix(sale)}>
                  <PencilLine className="size-3.5" /> Fix
                </Button>
                {isOwner ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Void sale"
                    onClick={() => voidSale(sale)}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                ) : (
                  // Staff correct their mistakes; only the owner erases a sale.
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    owner voids
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct this sale</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Change what was actually sold. Stock moves by the difference — lower a
              quantity and it goes back on the shelf.
            </p>

            {lines.map((line) => (
              <div
                key={line.product_id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border p-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{line.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ugx(line.unit_price)} each
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-7"
                    onClick={() => setQty(line.product_id, Math.max(0, line.quantity - 1))}
                  >
                    <Minus className="size-3" />
                  </Button>
                  <span className="w-10 text-center text-sm tabular-nums">
                    {line.quantity}
                  </span>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-7"
                    onClick={() => setQty(line.product_id, line.quantity + 1)}
                  >
                    <Plus className="size-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    title="Remove this line"
                    onClick={() => removeLine(line.product_id)}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </div>
            ))}

            <div className="flex justify-between border-t border-border pt-2 text-sm font-bold">
              <span>New total</span>
              <span>{ugx(newTotal)}</span>
            </div>
            {editing && newTotal !== Number(editing.total_amount) && (
              <p className="text-xs text-muted-foreground">
                Was {ugx(editing.total_amount)}.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
