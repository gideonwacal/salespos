import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Search, Plus, Download, Upload, PackagePlus, Pencil, Trash2, ImagePlus, Camera } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { insertRows, updateRow, deleteRow } from "@/lib/db";
import { useProducts, daysToExpiry, EXPIRY_WARNING_DAYS, type Product } from "@/lib/data";
import { ugx, num } from "@/lib/format";
import { Checkbox } from "@/components/ui/checkbox";
import { useIndustry } from "@/hooks/useIndustry";
import { hasFeature } from "@/lib/industry";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory Master Grid — SalesPos" },
      { name: "description", content: "Stock levels, buying and selling prices, margins and reorder alerts with CSV import/export." },
      { property: "og:title", content: "Inventory Master Grid — SalesPos" },
      { property: "og:description", content: "Stock levels, buying and selling prices, margins and reorder alerts with CSV import/export." },
    ],
  }),
  component: Inventory,
});

const blank = {
  name: "",
  category: "",
  unit_buying_price: "",
  unit_selling_price: "",
  wholesale_price: "",
  stock_quantity: "",
  reorder_level: "",
  expiry_date: "",
  barcode: "",
  unit_of_measure: "",
  batch_number: "",
  prescription_only: false,
};

function Inventory() {
  const { user, isOwner } = useAuth();
  // Everything trade-specific on this page comes from here: what a product
  // is called, which fields it has, and the categories on offer.
  const industry = useIndustry();
  const CATEGORIES = industry.categories;
  const queryClient = useQueryClient();
  const { data: products = [] } = useProducts();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ ...blank });
  const [open, setOpen] = useState(false);
  const [stockFor, setStockFor] = useState<Product | null>(null);
  const [stockQty, setStockQty] = useState("");
  const [stockNote, setStockNote] = useState("");
  const [stockExpiry, setStockExpiry] = useState("");
  const [damageFor, setDamageFor] = useState<Product | null>(null);
  const [damageQty, setDamageQty] = useState("");
  const [damageReason, setDamageReason] = useState("");
  const [damagePhoto, setDamagePhoto] = useState<File | null>(null);
  const [savingDamage, setSavingDamage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === "all" || p.category === category) &&
        (!q || p.name.toLowerCase().includes(q)),
    );
  }, [products, query, category]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...blank });
    setOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name,
      category: p.category,
      unit_buying_price: String(p.unit_buying_price),
      unit_selling_price: String(p.unit_selling_price),
      wholesale_price: p.wholesale_price != null ? String(p.wholesale_price) : "",
      stock_quantity: String(p.stock_quantity),
      reorder_level: String(p.reorder_level),
      expiry_date: p.expiry_date ?? "",
      barcode: p.barcode ?? "",
      unit_of_measure: p.unit_of_measure ?? "",
      batch_number: p.batch_number ?? "",
      prescription_only: p.prescription_only ?? false,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Item name is required");
    const payload = {
      name: form.name.trim(),
      category: form.category || CATEGORIES[0],
      unit_buying_price: Number(form.unit_buying_price) || 0,
      unit_selling_price: Number(form.unit_selling_price) || 0,
      wholesale_price: form.wholesale_price ? Number(form.wholesale_price) : null,
      stock_quantity: Number(form.stock_quantity) || 0,
      reorder_level: Number(form.reorder_level) || 0,
      expiry_date: form.expiry_date || null,
      barcode: form.barcode.trim(),
      unit_of_measure: form.unit_of_measure,
      batch_number: form.batch_number.trim(),
      prescription_only: form.prescription_only,
    };
    if (editing) await updateRow("products", editing.id, payload);
    else await insertRows("products", payload);
    toast.success(editing ? "Item updated" : "Item added");
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const remove = async (p: Product) => {
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    await deleteRow("products", p.id);
    toast.success("Item removed");
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const receiveStock = async () => {
    if (!stockFor || !user) return;
    const qty = Number(stockQty);
    if (!qty) return toast.error("Enter a quantity");
    await insertRows("stock_transactions", {
      product_id: stockFor.id,
      type: qty > 0 ? "stock_in" : "adjustment",
      quantity: qty,
      notes: stockNote.trim() || "Stock arrival",
      expiry_date: stockExpiry || null,
      performed_by: user.id,
    });
    toast.success("Stock movement recorded");
    setStockFor(null);
    setStockQty("");
    setStockNote("");
    setStockExpiry("");
    queryClient.invalidateQueries();
  };

  const submitDamage = async () => {
    if (!damageFor || !user) return;
    const qty = Number(damageQty);
    if (!qty || qty <= 0) return toast.error("Enter the damaged quantity");
    setSavingDamage(true);
    try {
      let photoPath: string | null = null;
      if (damagePhoto) {
        photoPath = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Could not read that photo"));
          reader.readAsDataURL(damagePhoto);
        });
      }
      await insertRows("damage_reports", {
        product_id: damageFor.id,
        quantity: qty,
        reason: damageReason.trim() || undefined,
        photo_url: photoPath ?? undefined,

        reported_by: user.id,
      });
      toast.success("Damage reported and stock adjusted");
      setDamageFor(null);
      setDamageQty("");
      setDamageReason("");
      setDamagePhoto(null);
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save damage report");
    } finally {
      setSavingDamage(false);
    }
  };

  const exportCsv = () => {
    const header = [
      "name",
      "category",
      "unit_buying_price",
      "unit_selling_price",
      "wholesale_price",
      "stock_quantity",
      "reorder_level",
    ];
    const csv = [
      header.join(","),
      ...products.map((p) =>
        [
          `"${p.name.replace(/"/g, '""')}"`,
          `"${p.category}"`,
          p.unit_buying_price,
          p.unit_selling_price,
          p.wholesale_price ?? "",
          p.stock_quantity,
          p.reorder_level,
        ].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const [head, ...lines] = text.trim().split(/\r?\n/);
    const cols = head.split(",").map((c) => c.trim().replace(/"/g, ""));
    const parsed = lines
      .map((line) => {
        const values = line.match(/("([^"]|"")*"|[^,]*)/g)?.filter((_, i) => i % 2 === 0) ?? [];
        const row: Record<string, string> = {};
        cols.forEach((c, i) => (row[c] = (values[i] ?? "").replace(/^"|"$/g, "").replace(/""/g, '"')));
        return row;
      })
      .filter((r) => r.name)
      .map((r) => ({
        name: r.name,
        category: r.category || "General Merchandise",
        unit_buying_price: Number(r.unit_buying_price) || 0,
        unit_selling_price: Number(r.unit_selling_price) || 0,
        wholesale_price: r.wholesale_price ? Number(r.wholesale_price) : null,
        stock_quantity: Number(r.stock_quantity) || 0,
        reorder_level: Number(r.reorder_level) || 0,
      }));
    if (!parsed.length) return toast.error("No valid rows found in that file");
    await insertRows("products", parsed);
    toast.success(`${parsed.length} items imported`);
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{industry.terms.inventory}</h1>
          <p className="text-sm text-muted-foreground">
            {products.length} items · valuation{" "}
            {ugx(products.reduce((a, p) => a + Number(p.unit_buying_price) * p.stock_quantity, 0))}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="size-4" /> Export CSV
          </Button>
          <>
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> Import CSV
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importCsv(f);
                  e.target.value = "";
                }}
              />
              <Button onClick={openNew}>
                <Plus className="size-4" /> New item
              </Button>
          </>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search items…"
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => (
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
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Buying</TableHead>
                <TableHead className="text-right">Retail</TableHead>
                <TableHead className="text-right">Wholesale</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const margin =
                  Number(p.unit_selling_price) > 0
                    ? ((Number(p.unit_selling_price) - Number(p.unit_buying_price)) /
                        Number(p.unit_selling_price)) *
                      100
                    : 0;
                const low = p.stock_quantity <= p.reorder_level;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.category}</TableCell>
                    <TableCell className="tabular text-right">
                      {ugx(p.unit_buying_price)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {ugx(p.unit_selling_price)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {p.wholesale_price ? ugx(p.wholesale_price) : "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular text-right font-semibold",
                        margin >= 15 ? "text-success" : "text-warning-foreground",
                      )}
                    >
                      {margin.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="outline"
                        className={cn(
                          "tabular",
                          low && "border-warning bg-warning-soft text-warning-foreground",
                        )}
                      >
                        {num(p.stock_quantity)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const d = daysToExpiry(p.expiry_date);
                        if (d === null) return <span className="text-muted-foreground">—</span>;
                        const bad = d < 0;
                        const soon = d >= 0 && d <= EXPIRY_WARNING_DAYS;
                        return (
                          <span
                            className={cn(
                              "text-xs font-medium",
                              bad && "text-destructive",
                              soon && "text-warning-foreground",
                            )}
                          >
                            {p.expiry_date}
                            {bad ? " · expired" : soon ? ` · ${d}d` : ""}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          onClick={() => setStockFor(p)}
                          title="Record stock arrival"
                        >
                          <PackagePlus className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          onClick={() => setDamageFor(p)}
                          title="Report damaged goods"
                        >
                          <Camera className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          onClick={() => openEdit(p)}
                          title="Edit item"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        {isOwner && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 text-destructive"
                            onClick={() => remove(p)}
                            title="Delete item"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? `Edit ${industry.terms.product}`
                : `New ${industry.terms.product}`}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>
                {industry.terms.product.charAt(0).toUpperCase() +
                  industry.terms.product.slice(1)}{" "}
                name
              </Label>
              <Input
                value={form.name}
                maxLength={120}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{industry.terms.category}</Label>
              <Select
                value={form.category || CATEGORIES[0]}
                onValueChange={(v) => setForm({ ...form, category: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(
              [
                ["unit_buying_price", "Buying price (UGX)"],
                ["unit_selling_price", "Retail price (UGX)"],
                ...(hasFeature(industry, "wholesale_price")
                  ? [
                      [
                        "wholesale_price",
                        industry.id === "hardware"
                          ? "Trade price (UGX)"
                          : "Wholesale price (UGX)",
                      ],
                    ]
                  : []),
                ["stock_quantity", "Stock quantity"],
                ["reorder_level", "Reorder level"],
              ] as [keyof typeof blank, string][]
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  type="number"
                  min={0}
                  value={String(form[key] ?? "")}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
            {hasFeature(industry, "unit_of_measure") && (
              <div className="space-y-1.5">
                <Label>Sold by</Label>
                <Select
                  value={form.unit_of_measure || (industry.units?.[0] ?? "piece")}
                  onValueChange={(v) => setForm({ ...form, unit_of_measure: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(industry.units ?? ["piece"]).map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {hasFeature(industry, "barcode") && (
              <div className="space-y-1.5">
                <Label>Barcode</Label>
                <Input
                  value={form.barcode}
                  maxLength={64}
                  placeholder="Scan or type"
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                />
              </div>
            )}
            {hasFeature(industry, "batch_number") && (
              <div className="space-y-1.5">
                <Label>Batch number</Label>
                <Input
                  value={form.batch_number}
                  maxLength={64}
                  placeholder="e.g. B-2291"
                  onChange={(e) => setForm({ ...form, batch_number: e.target.value })}
                />
              </div>
            )}
            {hasFeature(industry, "expiry") && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>
                  Expiry date {industry.id === "pharmacy" ? "" : "(optional)"}
                </Label>
                <Input
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                />
              </div>
            )}
            {hasFeature(industry, "prescription") && (
              <label className="flex items-center gap-2 sm:col-span-2">
                <Checkbox
                  checked={form.prescription_only}
                  onCheckedChange={(v) =>
                    setForm({ ...form, prescription_only: v === true })
                  }
                />
                <span className="text-sm">
                  Prescription only &mdash; the counter is warned before it is sold
                </span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save {industry.terms.product}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!stockFor} onOpenChange={(o) => !o && setStockFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Stock arrival — {stockFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Quantity (negative for adjustments)</Label>
              <Input
                type="number"
                value={stockQty}
                onChange={(e) => setStockQty(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Batch expiry date</Label>
              <Input
                type="date"
                value={stockExpiry}
                onChange={(e) => setStockExpiry(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input
                value={stockNote}
                maxLength={200}
                placeholder="Supplier / delivery note"
                onChange={(e) => setStockNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={receiveStock}>Record movement</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!damageFor} onOpenChange={(o) => !o && setDamageFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Report damaged goods — {damageFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Damaged quantity</Label>
              <Input
                type="number"
                min={1}
                value={damageQty}
                onChange={(e) => setDamageQty(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>What happened?</Label>
              <Input
                value={damageReason}
                maxLength={200}
                placeholder="Broken in store, leaking, expired…"
                onChange={(e) => setDamageReason(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Photo evidence</Label>
              <Input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setDamagePhoto(e.target.files?.[0] ?? null)}
              />
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ImagePlus className="size-3" />
                Take a photo of the damaged item or attach one from the device.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button disabled={savingDamage} onClick={submitDamage}>
              Save damage report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
