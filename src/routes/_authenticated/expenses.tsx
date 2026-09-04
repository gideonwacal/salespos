import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { insertRows, updateRow } from "@/lib/db";
import { useExpenses, isThisMonth, type Expense } from "@/lib/data";
import { ugx, shortDate, EXPENSE_CATEGORIES, PAYMENT_METHODS, paymentLabel } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({
    meta: [
      { title: "Expense Tracker — SalesPos" },
      { name: "description", content: "Log and review power, transport, rent, wages and other business overheads." },
      { property: "og:title", content: "Expense Tracker — SalesPos" },
      { property: "og:description", content: "Log and review power, transport, rent, wages and other business overheads." },
    ],
  }),
  component: Expenses,
});

function Expenses() {
  const { user, isOwner } = useAuth();
  const queryClient = useQueryClient();
  const { data: expenses = [] } = useExpenses();
  const [open, setOpen] = useState(false);
  const blank = {
    category: EXPENSE_CATEGORIES[0] as string,
    amount: "",
    vendor: "",
    description: "",
    payment_method: "cash",
    expense_date: new Date().toISOString().slice(0, 10),
  };
  const [form, setForm] = useState({ ...blank });
  const [editing, setEditing] = useState<Expense | null>(null);
  const [busy, setBusy] = useState(false);

  // An expense the owner has already ruled on is settled: the server refuses a
  // staff edit, so don't offer one either.
  const mayEdit = (e: Expense) => isOwner || e.status === "pending";

  const openNew = () => {
    setEditing(null);
    setForm({ ...blank });
    setOpen(true);
  };

  const openEdit = (e: Expense) => {
    setEditing(e);
    setForm({
      category: e.category,
      amount: String(e.amount),
      vendor: e.vendor ?? "",
      description: e.description ?? "",
      payment_method: e.payment_method,
      expense_date: e.expense_date,
    });
    setOpen(true);
  };

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    expenses
      .filter((e) => isThisMonth(e.expense_date))
      .forEach((e) => map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  const monthTotal = byCategory.reduce((a, [, v]) => a + v, 0);

  const save = async () => {
    if (!user) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return toast.error("Enter a valid amount");

    const payload = {
      category: form.category,
      amount,
      vendor: form.vendor.trim() || null,
      description: form.description.trim() || null,
      payment_method: form.payment_method,
      expense_date: form.expense_date,
    };

    setBusy(true);
    try {
      if (editing) {
        await updateRow("expenses", editing.id, payload);
        toast.success("Expense corrected");
      } else {
        await insertRows("expenses", { ...payload, logged_by: user.id });
        toast.success("Expense logged");
      }
      setOpen(false);
      setEditing(null);
      setForm({ ...blank });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the expense");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Expense tracker</h1>
          <p className="text-sm text-muted-foreground">
            Month-to-date overheads {ugx(monthTotal)}
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="size-4" /> Log expense
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {byCategory.map(([cat, value]) => (
          <Card key={cat} className="shadow-[var(--shadow-card)]">
            <CardContent className="pt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {cat}
              </p>
              <p className="tabular mt-2 text-xl font-bold">{ugx(value)}</p>
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-warning"
                  style={{ width: `${monthTotal ? (value / monthTotal) * 100 : 0}%` }}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">All logged expenses</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Paid via</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Correct</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{shortDate(e.expense_date)}</TableCell>
                  <TableCell className="font-medium">{e.category}</TableCell>
                  <TableCell className="text-muted-foreground">{e.vendor ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{e.description ?? "—"}</TableCell>
                  <TableCell>{paymentLabel(e.payment_method)}</TableCell>
                  <TableCell className="tabular text-right font-semibold">
                    {ugx(e.amount)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        e.status === "approved"
                          ? "border-success text-success"
                          : e.status === "rejected"
                            ? "border-destructive text-destructive"
                            : ""
                      }
                    >
                      {e.status ?? "pending"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {mayEdit(e) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Correct this expense"
                        onClick={() => openEdit(e)}
                      >
                        <PencilLine className="size-4" />
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">owner only</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Correct this expense" : "Log an expense"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount (UGX)</Label>
              <Input
                type="number"
                min={0}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Paid via</Label>
              <Select
                value={form.payment_method}
                onValueChange={(v) => setForm({ ...form, payment_method: v })}
              >
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Vendor / payee</Label>
              <Input
                value={form.vendor}
                maxLength={100}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                maxLength={300}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save expense</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
