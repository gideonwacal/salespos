import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Plus, Printer } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useQuotations, type Quotation } from "@/lib/data";
import { insertRows, updateRow, deleteRow } from "@/lib/db";
import { ugx, shortDate } from "@/lib/format";
import { useBusiness } from "@/hooks/useBusiness";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

export const Route = createFileRoute("/_authenticated/quotations")({
  head: () => ({
    meta: [
      { title: "Quotations & Invoices — SalesPos" },
      {
        name: "description",
        content: "Create, send and convert customer quotations into invoices and sales.",
      },
      { property: "og:title", content: "Quotations & Invoices — SalesPos" },
      {
        property: "og:description",
        content: "Create, send and convert customer quotations into invoices and sales.",
      },
    ],
  }),
  component: Quotations,
});

const STATUS: Record<string, string> = {
  draft: "bg-muted text-foreground",
  sent: "bg-primary/15 text-primary",
  accepted: "bg-success-soft text-success",
  invoiced: "bg-success text-success-foreground",
  expired: "bg-destructive text-destructive-foreground",
};

function Quotations() {
  const { isOwner } = useAuth();
  const { data: quotes = [] } = useQuotations();
  const business = useBusiness();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Quotation | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    items_summary: "",
    total_amount: "",
    valid_until: today,
    notes: "",
  });

  const refresh = () => qc.invalidateQueries();

  const save = async () => {
    if (!form.customer_name || !form.total_amount) {
      toast.error("Customer and amount are required");
      return;
    }
    await insertRows("quotations", {
      number: `QT-${1000 + quotes.length + 1}`,
      customer_name: form.customer_name,
      customer_phone: form.customer_phone || null,
      items_summary: form.items_summary,
      total_amount: Number(form.total_amount),
      valid_until: form.valid_until,
      status: "draft",
      notes: form.notes || null,
    });
    setForm({
      customer_name: "",
      customer_phone: "",
      items_summary: "",
      total_amount: "",
      valid_until: today,
      notes: "",
    });
    setOpen(false);
    refresh();
    toast.success("Quotation created");
  };

  const setStatus = async (q: Quotation, status: string) => {
    await updateRow("quotations", q.id, { status });
    refresh();
    toast.success(`Marked ${status}`);
  };

  const download = (q: Quotation) => {
    const esc = (v: string) =>
      v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const header = business.logo_url
      ? `<img src="${esc(business.logo_url)}" alt="${esc(business.name)}" style="height:70px" />`
      : `<h1 style="margin:0">${esc(business.name || "Your business")}</h1>`;
    const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(q.number)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;color:#111}
.muted{color:#666}.box{border-top:1px solid #ddd;border-bottom:1px solid #ddd;padding:12px 0;margin:16px 0}
.total{font-size:22px;font-weight:800}</style></head><body>
${header}
<p class="muted">${esc([business.address, business.city, business.phone].filter(Boolean).join(" · "))}</p>
<h2>${esc(q.number)}</h2>
<div class="box"><strong>Bill to: ${esc(q.customer_name)}</strong><br/>
<span class="muted">${esc(q.customer_phone ?? "")}</span></div>
<pre style="font-family:inherit;white-space:pre-wrap">${esc(q.items_summary)}</pre>
<p class="total">${esc(ugx(q.total_amount))}</p>
<p class="muted">Valid until ${esc(shortDate(q.valid_until))}</p>
<p class="muted">${esc(q.notes ?? "")}</p>
<p class="muted">${esc(business.receipt_footer ?? "")}</p>
</body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${q.number}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Quotation downloaded");
  };

  const remove = async (q: Quotation) => {
    await deleteRow("quotations", q.id);
    refresh();
  };

  const totalOpen = quotes
    .filter((q) => q.status === "draft" || q.status === "sent")
    .reduce((a, q) => a + Number(q.total_amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Quotations & invoices</h1>
          <p className="text-sm text-muted-foreground">
            {quotes.length} document(s) · {ugx(totalOpen)} awaiting a decision
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> New quotation
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New quotation</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Customer name</Label>
                <Input
                  value={form.customer_name}
                  onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  value={form.customer_phone}
                  onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Items</Label>
                <Textarea
                  rows={3}
                  placeholder="10 x Cola Crate, 5 x Cooking Oil 5L"
                  value={form.items_summary}
                  onChange={(e) => setForm({ ...form, items_summary: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Total amount</Label>
                <Input
                  type="number"
                  value={form.total_amount}
                  onChange={(e) => setForm({ ...form, total_amount: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Valid until</Label>
                <Input
                  type="date"
                  value={form.valid_until}
                  onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Notes</Label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={save}>Save quotation</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" /> All quotations
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Valid until</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="font-semibold">{q.number}</TableCell>
                  <TableCell>{q.customer_name}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-muted-foreground">
                    {q.items_summary}
                  </TableCell>
                  <TableCell>{shortDate(q.valid_until)}</TableCell>
                  <TableCell>
                    <Badge className={`border-0 capitalize ${STATUS[q.status] ?? ""}`}>
                      {q.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold">
                    {ugx(q.total_amount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Select value="" onValueChange={(v) => setStatus(q, v)}>
                      <SelectTrigger className="inline-flex h-8 w-[130px]">
                        <SelectValue placeholder="Update" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sent">Mark sent</SelectItem>
                        <SelectItem value="accepted">Mark accepted</SelectItem>
                        <SelectItem value="invoiced">Convert to invoice</SelectItem>
                        <SelectItem value="expired">Mark expired</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="ghost" onClick={() => setPreview(q)} title="Preview & print">
                      <Printer className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => download(q)} title="Download">
                      <Download className="size-4" />
                    </Button>
                    {isOwner && (
                      <Button size="sm" variant="ghost" onClick={() => remove(q)} title="Delete">
                        ✕
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {quotes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No quotations yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{preview?.number}</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-2 text-sm">
              {business.logo_url ? (
                <img
                  src={business.logo_url}
                  alt={`${business.name} logo`}
                  className="mb-1 h-16 w-auto object-contain"
                />
              ) : (
                <p className="text-base font-bold">{business.name || "Your business"}</p>
              )}
              <p className="text-muted-foreground">
                {[business.address, business.city, business.phone].filter(Boolean).join(" · ")}
              </p>
              <div className="border-y border-border py-2">
                <p className="font-semibold">Bill to: {preview.customer_name}</p>
                <p className="text-muted-foreground">{preview.customer_phone}</p>
              </div>
              <p className="whitespace-pre-wrap">{preview.items_summary}</p>
              <p className="text-lg font-extrabold">{ugx(preview.total_amount)}</p>
              <p className="text-muted-foreground">Valid until {shortDate(preview.valid_until)}</p>
              <p className="text-muted-foreground">{business.receipt_footer}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => preview && download(preview)}>
              <Download className="size-4" /> Download
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="size-4" /> Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
