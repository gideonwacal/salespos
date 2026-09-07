/**
 * The one form that registers a customer, used from both sides of the counter.
 *
 * A credit sale is an unsecured loan handed over at a till, and the only thing
 * that makes it collectable later is knowing who took it. So when this opens
 * from the credit section of the POS (`kyc`), the national ID, a phone number
 * and a residence stop being optional — the cashier cannot save a debtor the
 * owner would have no way of finding.
 *
 * The debtors page opens the same dialog without `kyc`, because the owner also
 * adds plain cash customers who only ever hold empties.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { insertRows } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Draft = {
  name: string;
  phone: string;
  alt_phone: string;
  nin: string;
  location: string;
  residence: string;
  occupation: string;
  guarantor_name: string;
  guarantor_phone: string;
  credit_limit: string;
  notes: string;
};

const EMPTY: Draft = {
  name: "",
  phone: "",
  alt_phone: "",
  nin: "",
  location: "",
  residence: "",
  occupation: "",
  guarantor_name: "",
  guarantor_phone: "",
  credit_limit: "",
  notes: "",
};

/** Uganda's NIN is 14 characters, starting CM/CF for citizens. */
const NIN_PATTERN = /^[A-Z0-9]{8,20}$/;

export function CustomerDialog({
  open,
  onOpenChange,
  kyc = false,
  trigger,
  onSaved,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Demand the details that make a debt collectable. */
  kyc?: boolean;
  /** Rendered as the button that opens the dialog; omit when driving `open`. */
  trigger?: React.ReactNode;
  /** Handed the new customer's id, so the POS can select them straight away. */
  onSaved?: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [uncontrolled, setUncontrolled] = useState(false);
  const isOpen = open ?? uncontrolled;
  const setOpen = onOpenChange ?? setUncontrolled;

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof Draft) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    const name = draft.name.trim();
    const nin = draft.nin.trim().toUpperCase();
    const phone = draft.phone.trim();

    if (!name) return toast.error("Customer name is required");
    if (kyc) {
      if (!phone) return toast.error("A phone contact is required for a credit customer");
      if (!nin) return toast.error("The National ID (NIN) is required for a credit customer");
      if (!NIN_PATTERN.test(nin)) return toast.error("That National ID does not look right");
      if (!draft.residence.trim()) {
        return toast.error("Where the customer resides is required for a credit customer");
      }
    }

    setBusy(true);
    try {
      const [row] = await insertRows("customers", {
        name,
        phone: phone || null,
        alt_phone: draft.alt_phone.trim(),
        nin,
        location: draft.location.trim(),
        residence: draft.residence.trim(),
        occupation: draft.occupation.trim(),
        guarantor_name: draft.guarantor_name.trim(),
        guarantor_phone: draft.guarantor_phone.trim(),
        credit_limit: Number(draft.credit_limit) || 0,
        notes: draft.notes.trim() || null,
        bottles_owed: 0,
      });
      toast.success(kyc ? "Credit customer registered" : "Customer added");
      setDraft(EMPTY);
      setOpen(false);
      queryClient.invalidateQueries();
      if (row?.id) onSaved?.(String(row.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save customer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{kyc ? "Register a credit customer" : "Add customer"}</DialogTitle>
          <DialogDescription>
            {kyc
              ? "Money leaving on credit needs a person attached to it. Fill in enough to find them again."
              : "Saved customers can buy on credit and hold empties."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Full name" required value={draft.name} onChange={set("name")} max={100} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Phone contact"
              required={kyc}
              value={draft.phone}
              onChange={set("phone")}
              max={40}
              placeholder="0771 234 567"
            />
            <Field
              label="Other phone"
              value={draft.alt_phone}
              onChange={set("alt_phone")}
              max={40}
              placeholder="Next of kin or second line"
            />
          </div>

          <Field
            label="National ID (NIN)"
            required={kyc}
            value={draft.nin}
            onChange={(v) => set("nin")(v.toUpperCase())}
            max={20}
            placeholder="CM12345678ABCD"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Location / trading area"
              value={draft.location}
              onChange={set("location")}
              max={200}
              placeholder="Nakawa Market, stall 14"
            />
            <Field
              label="Residing place"
              required={kyc}
              value={draft.residence}
              onChange={set("residence")}
              max={200}
              placeholder="Kireka, Kamuli Road"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Occupation / business"
              value={draft.occupation}
              onChange={set("occupation")}
              max={120}
              placeholder="Retail shop owner"
            />
            <div className="space-y-1.5">
              <Label>Credit limit (optional)</Label>
              <Input
                type="number"
                min={0}
                value={draft.credit_limit}
                onChange={(e) => set("credit_limit")(e.target.value)}
                placeholder="0 = no ceiling"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Guarantor / referee"
              value={draft.guarantor_name}
              onChange={set("guarantor_name")}
              max={200}
            />
            <Field
              label="Guarantor phone"
              value={draft.guarantor_phone}
              onChange={set("guarantor_phone")}
              max={40}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={draft.notes}
              onChange={(e) => set("notes")(e.target.value)}
              maxLength={300}
              placeholder="Anything else the owner should know"
            />
          </div>

          <Button className="w-full" onClick={save} disabled={busy}>
            <UserPlus className="size-4" />
            {busy ? "Saving…" : kyc ? "Register customer" : "Save customer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  max,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={max}
        placeholder={placeholder}
      />
    </div>
  );
}
