import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Store, ArrowRight } from "lucide-react";
import { getBusiness, CURRENCIES } from "@/lib/demo";
import { saveBusinessProfile } from "@/lib/db";
import { APP } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LogoPicker } from "@/components/LogoPicker";
import { INDUSTRY_PROFILES, resolveIndustry } from "@/lib/industry";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/setup")({
  head: () => ({
    meta: [
      { title: "Business setup — SalesPos" },
      { name: "description", content: "Add your business profile, currency, tax details and receipt branding to finish setting up SalesPos." },
      { property: "og:title", content: "Business setup — SalesPos" },
      { property: "og:description", content: "Add your business profile, currency and receipt branding to finish setup." },
    ],
  }),
  component: Setup,
});

function Setup() {
  const navigate = useNavigate();
  const existing = typeof window !== "undefined" ? getBusiness() : null;
  const [form, setForm] = useState(() => ({ ...getBusiness() }));
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const activeIndustry = resolveIndustry(form.industry);

  // Switching trade brings that trade's alert defaults with it, so a
  // hardware store isn't nagged about expiry dates on cement.
  const pickIndustry = (id: string) => {
    const profile = resolveIndustry(id);
    setForm((f) => ({
      ...f,
      industry: profile.id,
      low_stock_alerts: profile.defaults.low_stock_alerts,
      expiry_alerts: profile.defaults.expiry_alerts,
    }));
  };

  const [saving, setSaving] = useState(false);

  const finish = async () => {
    if (!form.name.trim()) return toast.error("Business name is required");
    const currency = CURRENCIES.find((c) => c.code === form.currency);
    setSaving(true);
    try {
      await saveBusinessProfile({
        ...form,
        name: form.name.trim(),
        currency_symbol: currency?.symbol ?? form.currency,
        configured: true,
      });
      toast.success("Business profile saved");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-brand text-brand-foreground">
          <Store className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold">
            {existing?.configured ? "Business profile" : `Set up your ${APP.name} workspace`}
          </h1>
          <p className="text-sm text-muted-foreground">
            These details appear on receipts, reports and throughout the app.
          </p>
        </div>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">Business profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" required>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Tagline">
            <Input
              value={form.tagline}
              onChange={(e) => set("tagline", e.target.value)}
              placeholder="Wholesale & retail merchandise"
            />
          </Field>
          <Field label="Industry">
            <Select value={activeIndustry.id} onValueChange={pickIndustry}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRY_PROFILES.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{activeIndustry.blurb}</p>
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Tax / TIN number">
            <Input value={form.tax_id} onChange={(e) => set("tax_id", e.target.value)} />
          </Field>
          <Field label="Street address" full>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="City / town">
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="Country">
            <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">Currency, tax & receipt</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Currency">
            <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} — {c.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="VAT / sales tax %">
            <Input
              type="number"
              value={form.vat_percent}
              onChange={(e) => set("vat_percent", Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Company logo" full>
            <LogoPicker
              value={form.logo_url}
              onChange={(logo_url) => set("logo_url", logo_url)}
            />
          </Field>
          <Field label="Receipt footer message" full>
            <Textarea
              rows={2}
              value={form.receipt_footer}
              onChange={(e) => set("receipt_footer", e.target.value)}
              placeholder="Thank you for your business!"
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" onClick={finish} disabled={saving}>
          {existing?.configured ? "Save changes" : "Finish setup"} <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  full,
  required,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
  required?: boolean;
}) {
  return (
    <div className={`space-y-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
