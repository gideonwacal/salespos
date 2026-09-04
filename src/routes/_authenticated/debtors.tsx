import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, HandCoins, Plus, Recycle, UserPlus } from "lucide-react";
import {
  useCustomers,
  useDebts,
  useBottleMovements,
  debtStatus,
  outstanding,
  type Debt,
} from "@/lib/data";
import { insertRows } from "@/lib/db";
import { ugx, num, shortDate, DEBT_STATUS, PAYMENT_METHODS } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
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

export const Route = createFileRoute("/_authenticated/debtors")({
  head: () => ({
    meta: [
      { title: "Credit & Debtors — SalesPos" },
      {
        name: "description",
        content: "Track credit sales, outstanding balances, due dates and glass bottle returns.",
      },
      { property: "og:title", content: "Credit & Debtors — SalesPos" },
      {
        property: "og:description",
        content: "Track credit sales, outstanding balances, due dates and glass bottle returns.",
      },
    ],
  }),
  component: DebtorsPage,
});

function DebtorsPage() {
  const queryClient = useQueryClient();
  const { data: customers = [] } = useCustomers();
  const { data: debts = [] } = useDebts();
  const { data: movements = [] } = useBottleMovements();
  const [payDebt, setPayDebt] = useState<Debt | null>(null);

  const rows = useMemo(
    () =>
      debts
        .map((d) => ({ ...d, live: debtStatus(d), balance: outstanding(d) }))
        .sort((a, b) => (a.live === "overdue" ? -1 : 1) - (b.live === "overdue" ? -1 : 1)),
    [debts],
  );

  const totalOutstanding = rows.reduce((a, d) => a + d.balance, 0);
  const overdue = rows.filter((d) => d.live === "overdue");
  const bottlesOwed = customers.reduce((a, c) => a + Number(c.bottles_owed), 0);
  const name = (id: string) => customers.find((c) => c.id === id)?.name ?? "Unknown customer";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold">Credit sales & debtors</h1>
          <p className="text-sm text-muted-foreground">
            Track who owes money, when it is due, and which empties are still out there.
          </p>
        </div>
        <div className="flex gap-2">
          <NewCustomerDialog />
          <NewDebtDialog />
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-bold text-destructive">
              {overdue.length} overdue account{overdue.length > 1 ? "s" : ""} —{" "}
              {ugx(overdue.reduce((a, d) => a + d.balance, 0))} past due
            </p>
            <p className="text-xs text-destructive/80">
              {overdue.map((d) => name(d.customer_id)).join(", ")}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total outstanding" value={ugx(totalOutstanding)} tone="warning" />
        <Stat label="Overdue balance" value={ugx(overdue.reduce((a, d) => a + d.balance, 0))} tone="danger" />
        <Stat label="Empties still out" value={`${num(bottlesOwed)} bottles`} tone="success" />
      </div>

      <Tabs defaultValue="debts">
        <TabsList>
          <TabsTrigger value="debts">Debtor ledger</TabsTrigger>
          <TabsTrigger value="bottles">Bottle returns</TabsTrigger>
        </TabsList>

        <TabsContent value="debts" className="pt-4">
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((d) => {
                    const c = customers.find((x) => x.id === d.customer_id);
                    return (
                      <TableRow key={d.id} className={cn(d.live === "overdue" && "bg-destructive/5")}>
                        <TableCell>
                          <p className="font-medium">{name(d.customer_id)}</p>
                          <p className="text-[11px] text-muted-foreground">{c?.phone ?? "—"}</p>
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                          {d.items_summary}
                        </TableCell>
                        <TableCell className="tabular text-right">{ugx(d.total_value)}</TableCell>
                        <TableCell className="tabular text-right font-semibold">
                          {ugx(d.balance)}
                        </TableCell>
                        <TableCell className="text-xs">{shortDate(d.due_date)}</TableCell>
                        <TableCell>
                          <Badge className={cn("border-0", DEBT_STATUS[d.live].className)}>
                            {DEBT_STATUS[d.live].label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={d.balance <= 0}
                            onClick={() => setPayDebt(d)}
                          >
                            <HandCoins className="size-3.5" /> Log payment
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                        No credit sales recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bottles" className="space-y-4 pt-4">
          <div className="grid gap-3 md:grid-cols-2">
            {customers.map((c) => (
              <Card key={c.id} className="shadow-[var(--shadow-card)]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <CardDescription>{c.phone ?? "No contact"}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase text-muted-foreground">Empties owed</p>
                    <p
                      className={cn(
                        "tabular text-2xl font-extrabold",
                        c.bottles_owed > 0 ? "text-warning-foreground" : "text-success",
                      )}
                    >
                      {num(c.bottles_owed)}
                    </p>
                  </div>
                  <BottleDialog customerId={c.id} owed={Number(c.bottles_owed)} />
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent bottle movements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {movements.slice(0, 12).map((m) => (
                <div key={m.id} className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0">
                  <span>{name(m.customer_id)}</span>
                  <span
                    className={cn(
                      "tabular font-semibold",
                      m.direction === "returned" ? "text-success" : "text-warning-foreground",
                    )}
                  >
                    {m.direction === "returned" ? "+" : "-"}
                    {num(m.quantity)}
                  </span>
                </div>
              ))}
              {movements.length === 0 && (
                <p className="text-sm text-muted-foreground">No bottle movements yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <LogPaymentDialog
        debt={payDebt}
        onClose={() => setPayDebt(null)}
        onDone={() => queryClient.invalidateQueries()}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={cn(
            "tabular mt-1 text-xl font-extrabold",
            tone === "danger" && "text-destructive",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning-foreground",
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function NewCustomerDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const save = async () => {
    if (!name.trim()) return toast.error("Customer name is required");
    try {
      await insertRows("customers", {
        name: name.trim(),
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        bottles_owed: 0,
      });
      toast.success("Customer added");
      setOpen(false);
      setName("");
      setPhone("");
      setNotes("");
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save customer");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserPlus className="size-4" /> New customer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add customer</DialogTitle>
          <DialogDescription>Saved customers can buy on credit and hold empties.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-1.5">
            <Label>Contact</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
          </div>
          <Button className="w-full" onClick={save}>
            Save customer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewDebtDialog() {
  const queryClient = useQueryClient();
  const { data: customers = [] } = useCustomers();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [items, setItems] = useState("");
  const [value, setValue] = useState("");
  const [due, setDue] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });

  const save = async () => {
    if (!customerId) return toast.error("Pick a customer");
    if (!Number(value)) return toast.error("Enter the credit amount");
    try {
      await insertRows("debts", {
        customer_id: customerId,
        sale_id: null,
        items_summary: items.trim() || "Manual credit entry",
        total_value: Number(value),
        amount_paid: 0,
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: due,
        status: "pending",
      });
      toast.success("Credit recorded");
      setOpen(false);
      setItems("");
      setValue("");
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record credit");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> Record credit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a credit sale</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger>
                <SelectValue placeholder="Select customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Items</Label>
            <Input value={items} onChange={(e) => setItems(e.target.value)} maxLength={300} />
          </div>
          <div className="space-y-1.5">
            <Label>Total value (UGX)</Label>
            <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Due date</Label>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Button className="w-full" onClick={save}>
            Save credit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BottleDialog({ customerId, owed }: { customerId: string; owed: number }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [direction, setDirection] = useState<"returned" | "taken">("returned");

  const save = async () => {
    const q = Number(qty);
    if (!q || q <= 0) return toast.error("Enter a bottle count");
    if (direction === "returned" && q > owed) return toast.error("More than the customer owes");
    try {
      await insertRows("bottle_movements", {
        customer_id: customerId,
        sale_id: null,
        direction,
        quantity: q,
        note: direction === "returned" ? "Empties returned at shop" : "Empties taken",
      });
      toast.success(direction === "returned" ? "Return recorded" : "Bottles logged");
      setOpen(false);
      setQty("");
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record movement");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Recycle className="size-3.5" /> Log bottles
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bottle movement</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Direction</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as "returned" | "taken")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="returned">Empties returned</SelectItem>
                <SelectItem value="taken">Empties taken out</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Quantity</Label>
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <Button className="w-full" onClick={save}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LogPaymentDialog({
  debt,
  onClose,
  onDone,
}: {
  debt: Debt | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const balance = debt ? outstanding(debt) : 0;

  const save = async () => {
    if (!debt) return;
    const value = Number(amount);
    if (!value || value <= 0) return toast.error("Enter an amount");
    if (value > balance) return toast.error("Amount is more than the outstanding balance");
    try {
      await insertRows("debt_payments", {
        debt_id: debt.id,
        amount: value,
        payment_method: method,
        note: null,
      });
      toast.success("Payment logged");
      setAmount("");
      onClose();
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not log payment");
    }
  };

  return (
    <Dialog open={!!debt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log payment</DialogTitle>
          <DialogDescription>Outstanding balance: {ugx(balance)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Amount received (UGX)</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.filter((p) => p.value !== "credit").map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAmount(String(balance))}>
              Full settlement
            </Button>
            <Button className="flex-1" onClick={save}>
              Save payment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
