import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { wipeWorkspace, resetDemo, isDemo } from "@/lib/demo";
import { saveBusinessProfile } from "@/lib/db";
import { useBusiness } from "@/hooks/useBusiness";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { LogoPicker } from "@/components/LogoPicker";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Business Settings — SalesPos" },
      { name: "description", content: "Update branding, receipt text, alert thresholds and workspace data for your SalesPos account." },
      { property: "og:title", content: "Business Settings — SalesPos" },
      { property: "og:description", content: "Update branding, receipt text and alert preferences." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const business = useBusiness();
  const { isOwner } = useAuth();
  const [form, setForm] = useState(() => ({ ...business }));
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const [saving, setSaving] = useState(false);
  // Only the owner may edit; the server enforces the same rule, so letting a
  // salesperson type here would only earn them a 403 on save.
  const locked = !isOwner;

  // The owner's own edits land through `form`; anyone else follows the server.
  useEffect(() => {
    if (locked) setForm({ ...business });
  }, [locked, business]);

  const save = async () => {
    setSaving(true);
    try {
      await saveBusinessProfile(form);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Business settings</h1>
        <p className="text-sm text-muted-foreground">
          Branding, receipts and alerts for {business.name}.
        </p>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">Profile & branding</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Business name</Label>
            <Input
              value={form.name}
              disabled={locked}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tagline</Label>
            <Input
              value={form.tagline}
              disabled={locked}
              onChange={(e) => set("tagline", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input
              value={form.phone}
              disabled={locked}
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              value={form.email}
              disabled={locked}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Company logo</Label>
            <LogoPicker
              value={form.logo_url}
              disabled={locked}
              onChange={(logo_url) => set("logo_url", logo_url)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Address</Label>
            <Input
              value={form.address}
              disabled={locked}
              onChange={(e) => set("address", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Receipt footer</Label>
            <Textarea
              rows={2}
              value={form.receipt_footer}
              disabled={locked}
              onChange={(e) => set("receipt_footer", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Printed at the bottom of every receipt and quotation.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">Alerts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            label="Low stock alerts"
            hint="Banner and dashboard warnings when items fall to their reorder level."
            checked={form.low_stock_alerts}
            disabled={locked}
            onChange={(v) => set("low_stock_alerts", v)}
          />
          <ToggleRow
            label="Expiry alerts"
            hint="Warn when stock is within 30 days of its expiry date."
            checked={form.expiry_alerts}
            disabled={locked}
            onChange={(v) => set("expiry_alerts", v)}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {locked && (
          <p className="text-sm text-muted-foreground">
            Only the owner can change these. You see whatever they have set.
          </p>
        )}
        {!locked && (
          <Button onClick={save} disabled={saving}>
            Save settings
          </Button>
        )}
      </div>

      {/* Erasing the workspace is the owner's call, never the counter's. */}
      {!locked && (
      <Card className="border-destructive/40 shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="size-4" /> Danger zone
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-sm text-sm text-muted-foreground">
            {isDemo()
              ? "Reload the demo sandbox with fresh sample data."
              : "Erase all products, sales, expenses and users in this workspace. This cannot be undone."}
          </p>
          <Button
            variant="destructive"
            onClick={() => {
              if (isDemo()) {
                resetDemo();
                toast.success("Demo data reset");
                return;
              }
              if (!confirm("Erase every record in this workspace?")) return;
              wipeWorkspace();
              window.location.href = "/auth";
            }}
          >
            {isDemo() ? "Reset demo data" : "Erase workspace"}
          </Button>
        </CardContent>
      </Card>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
