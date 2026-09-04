import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Printer,
  ShoppingCart,
  AlertTriangle,
  Recycle,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  useProducts,
  useCustomers,
  useDebts,
  outstanding,
  debtStatus,
  type Product,
} from "@/lib/data";
import { insertRows, checkoutSale } from "@/lib/db";
import {
  ugx,
  num,
  roundToCurrency,
  PAYMENT_METHODS,
  paymentLabel,
  tieredPrice,
} from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { useBusiness } from "@/hooks/useBusiness";
import { PosCalculator } from "@/components/PosCalculator";
import { RecentSales } from "@/components/RecentSales";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/pos")({
  head: () => ({
    meta: [
      { title: "POS Terminal — SalesPos" },
      {
        name: "description",
        content: "Fast wholesale and retail checkout terminal for your shop floor.",
      },
      { property: "og:title", content: "POS Terminal — SalesPos" },
      {
        property: "og:description",
        content: "Fast wholesale and retail checkout terminal for your shop floor.",
      },
    ],
  }),
  component: POS,
});

type CartLine = { product: Product; qty: number };
type Receipt = {
  number: string;
  date: string;
  lines: { name: string; qty: number; price: number }[];
  total: number;
  discount: number;
  saleType: string;
  payment: string;
  customer: string;
  cashier: string;
  bottles: number;
};

function POS() {
  const { user, fullName } = useAuth();
  const biz = useBusiness();
  const queryClient = useQueryClient();
  const { data: products = [] } = useProducts();
  const { data: customers = [] } = useCustomers();
  const { data: debts = [] } = useDebts();

  const [query, setQuery] = useState("");
  const [saleType, setSaleType] = useState<"retail" | "wholesale">("retail");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState("cash");
  const [customerId, setCustomerId] = useState("walkin");
  const [customerName, setCustomerName] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [depositPaid, setDepositPaid] = useState(true);
  const [bottlesReturned, setBottlesReturned] = useState("");
  const [override, setOverride] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 60);
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
      .slice(0, 60);
  }, [products, query]);

  const linePrice = (l: CartLine) => tieredPrice(l.product, saleType, l.qty);
  const subtotal = cart.reduce((a, l) => a + linePrice(l) * l.qty, 0);
  const total = override ?? subtotal;
  const discount = Math.max(0, subtotal - total);
  const cost = cart.reduce((a, l) => a + Number(l.product.unit_buying_price) * l.qty, 0);
  const bottlesInCart = cart.reduce(
    (a, l) => a + (l.product.is_glass_bottle ? Number(l.product.bottles_per_unit || 1) * l.qty : 0),
    0,
  );

  const customer = customers.find((c) => c.id === customerId) ?? null;
  const customerDebt = customer
    ? debts
        .filter((d) => d.customer_id === customer.id && debtStatus(d) !== "cleared")
        .reduce((a, d) => a + outstanding(d), 0)
    : 0;
  const returnedNow = Math.max(0, Number(bottlesReturned) || 0);
  const bottlesStillOwed = Math.max(0, (customer?.bottles_owed ?? 0) - returnedNow);

  const isCredit = payment === "credit";
  const bottleBlock =
    isCredit && bottlesInCart > 0 && (bottlesStillOwed > 0 || customerDebt > 0)
      ? bottlesStillOwed > 0
        ? `${customer?.name} still owes ${bottlesStillOwed} empties. Record the returns or take cash for glass-bottled drinks.`
        : `${customer?.name} has an unpaid balance of ${ugx(customerDebt)}. Clear it before another glass-bottle credit sale.`
      : null;

  const add = (p: Product) => {
    setOverride(null);
    // Pharmacy rule: the counter must see this before it sells.
    if (p.prescription_only) {
      toast.warning(`${p.name} is prescription only — check the prescription first`);
    }
    setCart((prev) => {
      const found = prev.find((l) => l.product.id === p.id);
      if (found) return prev.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { product: p, qty: 1 }];
    });
  };

  const setQty = (id: string, qty: number) => {
    setOverride(null);
    setCart((prev) =>
      qty <= 0
        ? prev.filter((l) => l.product.id !== id)
        : prev.map((l) => (l.product.id === id ? { ...l, qty } : l)),
    );
  };

  const checkout = async () => {
    if (!cart.length) return toast.error("Cart is empty");
    if (!user) return toast.error("Not signed in");
    const overs = cart.filter((l) => l.qty > l.product.stock_quantity);
    if (overs.length) return toast.error(`Not enough stock for ${overs[0].product.name}`);
    if (isCredit && !customer) return toast.error("Pick a saved customer for a credit sale");
    if (bottleBlock) return toast.error(bottleBlock);

    setBusy(true);
    try {
      // One call: on the server this commits the sale, its lines and the stock
      // movement in a single transaction.
      const sale = await checkoutSale({
        sale_type: saleType,
        total_amount: total,
        total_cost: cost,
        payment_method: payment,
        customer_name: customer?.name ?? customerName.trim() ?? null,
        cashier_id: user.id,
        lines: cart.map((l) => ({
          product_id: l.product.id,
          quantity: l.qty,
          unit_price: linePrice(l),
          unit_cost: Number(l.product.unit_buying_price),
          subtotal: linePrice(l) * l.qty,
        })),
      });

      if (isCredit && customer) {
        await insertRows("debts", {
          customer_id: customer.id,
          sale_id: sale.id,
          items_summary: cart.map((l) => `${l.qty} x ${l.product.name}`).join(", "),
          total_value: total,
          amount_paid: 0,
          issue_date: new Date().toISOString().slice(0, 10),
          due_date: dueDate,
          status: "pending",
        });
      }

      if (customer) {
        if (returnedNow > 0) {
          await insertRows("bottle_movements", {
            customer_id: customer.id,
            sale_id: sale.id,
            direction: "returned",
            quantity: returnedNow,
            note: "Returned at checkout",
          });
        }
        if (bottlesInCart > 0 && (isCredit || !depositPaid)) {
          await insertRows("bottle_movements", {
            customer_id: customer.id,
            sale_id: sale.id,
            direction: "taken",
            quantity: bottlesInCart,
            note: isCredit ? "Credit sale — empties owed" : "No deposit paid",
          });
        }
      }

      setReceipt({
        number: String(sale.id).slice(0, 8).toUpperCase(),
        date: new Date().toLocaleString("en-GB"),
        lines: cart.map((l) => ({ name: l.product.name, qty: l.qty, price: linePrice(l) })),
        total,
        discount,
        saleType,
        payment: paymentLabel(payment),
        customer: customer?.name || customerName.trim() || "Walk-in customer",
        cashier: fullName || user.email || "",
        bottles: bottlesInCart,
      });
      setCart([]);
      setCustomerName("");
      setBottlesReturned("");
      setOverride(null);
      toast.success(isCredit ? "Credit sale recorded on the debtor's account" : "Sale recorded");
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not complete sale");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Search item or scan barcode…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div id="tour-saletype" className="flex rounded-lg border border-border bg-card p-1">
            {(["retail", "wholesale"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setSaleType(t);
                  setOverride(null);
                }}
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm font-semibold capitalize transition-colors",
                  saleType === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const low = p.stock_quantity <= p.reorder_level;
            return (
              <button
                key={p.id}
                onClick={() => add(p)}
                disabled={p.stock_quantity <= 0}
                className="rounded-xl border border-border bg-card p-4 text-left shadow-[var(--shadow-card)] transition-colors hover:border-primary disabled:opacity-50"
              >
                <p className="text-sm font-semibold leading-tight">{p.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{p.category}</p>
                {p.bulk_min_qty > 0 && p.bulk_discount_percent > 0 && (
                  <p className="mt-1 text-[11px] font-medium text-success">
                    {p.bulk_min_qty}+ → {p.bulk_discount_percent}% off
                  </p>
                )}
                <div className="mt-3 flex items-end justify-between">
                  <span className="tabular text-base font-bold text-success">
                    {ugx(tieredPrice(p, saleType, 1))}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "tabular text-[11px]",
                      low && "border-warning bg-warning-soft text-warning-foreground",
                    )}
                  >
                    {num(p.stock_quantity)} left
                  </Badge>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">No items match that search.</p>
          )}
        </div>

        {/* A cashier who mis-keys a sale fixes it here, without calling the owner. */}
        <RecentSales />
      </div>

      <Card id="tour-cart" className="h-fit lg:sticky lg:top-24 shadow-[var(--shadow-card)]">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingCart className="size-4" /> Cart
          </CardTitle>
          <Badge variant="secondary" className="capitalize">
            {saleType}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {cart.length === 0 && (
              <p className="text-sm text-muted-foreground">Tap an item to add it to the cart.</p>
            )}
            {cart.map((l) => (
              <div key={l.product.id} className="rounded-lg border border-border p-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-tight">{l.product.name}</p>
                  <button onClick={() => setQty(l.product.id, 0)}>
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-7"
                      onClick={() => setQty(l.product.id, l.qty - 1)}
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span className="tabular w-8 text-center text-sm">{l.qty}</span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-7"
                      onClick={() => setQty(l.product.id, l.qty + 1)}
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                  <span className="tabular text-sm font-semibold">{ugx(linePrice(l) * l.qty)}</span>
                </div>
                {l.product.bulk_min_qty > 0 &&
                  l.product.bulk_discount_percent > 0 &&
                  l.qty >= l.product.bulk_min_qty && (
                    <p className="mt-1 text-[11px] font-medium text-success">
                      Bulk price applied ({l.product.bulk_discount_percent}% off)
                    </p>
                  )}
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Select
              value={customerId}
              onValueChange={(v) => {
                setCustomerId(v);
                setBottlesReturned("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="walkin">Walk-in customer</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {customerId === "walkin" && (
              <Input
                placeholder="Name on receipt (optional)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                maxLength={80}
              />
            )}
            {customer && (
              <p className="text-[11px] text-muted-foreground">
                Empties owed: <span className="font-semibold">{num(customer.bottles_owed)}</span> ·
                Balance: <span className="font-semibold">{ugx(customerDebt)}</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Payment method</Label>
            <Select value={payment} onValueChange={setPayment}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isCredit && (
            <div className="space-y-1.5">
              <Label>Payment due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}

          {bottlesInCart > 0 && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="flex items-center gap-2 text-xs font-semibold">
                <Recycle className="size-3.5 text-success" /> {num(bottlesInCart)} glass bottles in
                this sale
              </p>
              {customer && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Empties returned now</Label>
                  <Input
                    type="number"
                    min={0}
                    value={bottlesReturned}
                    onChange={(e) => setBottlesReturned(e.target.value)}
                    placeholder="0"
                  />
                </div>
              )}
              {!isCredit && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Bottle deposit paid in cash</Label>
                  <Switch checked={depositPaid} onCheckedChange={setDepositPaid} />
                </div>
              )}
            </div>
          )}

          {bottleBlock && (
            <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-xs font-medium text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {bottleBlock}
            </p>
          )}

          <div className="rounded-lg bg-success-soft p-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Items</span>
              <span className="tabular">{cart.reduce((a, l) => a + l.qty, 0)}</span>
            </div>
            {discount > 0 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Discount</span>
                <span className="tabular">-{ugx(discount)}</span>
              </div>
            )}
            <div className="mt-1 flex items-center justify-between">
              <span className="font-semibold">Total</span>
              <span className="tabular text-xl font-extrabold text-success">{ugx(total)}</span>
            </div>
          </div>

          <Button
            className="w-full bg-success text-success-foreground hover:bg-success/90"
            size="lg"
            disabled={busy || cart.length === 0 || !!bottleBlock}
            onClick={checkout}
          >
            {isCredit ? "Record credit sale" : "Complete sale"}
          </Button>
        </CardContent>
      </Card>

      <PosCalculator
        onApply={(value) => {
          if (!cart.length) return toast.error("Add items before applying a total");
          setOverride(Math.max(0, roundToCurrency(value)));
          toast.success("Total applied to checkout");
        }}
      />

      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="no-print">
            <DialogTitle>Receipt</DialogTitle>
          </DialogHeader>
          {receipt && (
            <div className="space-y-3 font-mono text-xs" id="receipt">
              <div className="text-center">
                {biz.logo_url ? (
                  <img
                    src={biz.logo_url}
                    alt={`${biz.name} logo`}
                    className="mx-auto mb-2 h-16 w-auto object-contain"
                  />
                ) : (
                  <p className="text-sm font-bold">{biz.name}</p>
                )}
                <p>{biz.address}</p>
                <p>{biz.tagline}</p>
              </div>
              <div className="border-y border-dashed border-border py-2">
                <p>Receipt #{receipt.number}</p>
                <p>{receipt.date}</p>
                <p>Customer: {receipt.customer}</p>
                <p>Type: {receipt.saleType}</p>
                <p>Served by: {receipt.cashier}</p>
              </div>
              <div className="space-y-1">
                {receipt.lines.map((l, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span className="truncate">
                      {l.qty} x {l.name}
                    </span>
                    <span>{ugx(l.qty * l.price)}</span>
                  </div>
                ))}
              </div>
              {receipt.discount > 0 && (
                <div className="flex justify-between">
                  <span>Discount</span>
                  <span>-{ugx(receipt.discount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-dashed border-border pt-2 text-sm font-bold">
                <span>TOTAL</span>
                <span>{ugx(receipt.total)}</span>
              </div>
              <p>Paid by: {receipt.payment}</p>
              {receipt.bottles > 0 && <p>Empties on this sale: {receipt.bottles}</p>}
              <div className="space-y-1 text-center">
                {biz.receipt_footer ? (
                  // The owner's footer, set in Settings, on every receipt the
                  // salesperson prints.
                  <p className="whitespace-pre-line">{biz.receipt_footer}</p>
                ) : (
                  <p>Webale nnyo — Thank you!</p>
                )}
                {biz.phone && <p>{biz.phone}</p>}
              </div>
              <Button variant="outline" className="no-print w-full" onClick={() => window.print()}>
                <Printer className="size-4" /> Print / Save PDF
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
