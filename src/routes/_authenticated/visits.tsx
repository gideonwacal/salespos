/**
 * The queue, and the consultation that empties it.
 *
 * A clinic's day is a line of people in four states: waiting to be seen, with
 * the clinician, waiting for medicine, done. The board shows those columns and
 * opening anyone on it opens their visit — vitals, what was found, what was
 * ordered, and what the dispensary actually handed over.
 *
 * Ordered and dispensed are kept apart throughout. A clinician writes for
 * thirty tablets and there are twenty; the record has to be able to say that
 * rather than quietly agreeing with whichever number was typed last.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ClipboardPlus, Pill, Stethoscope, UserPlus } from "lucide-react";
import { usePatients, useProducts, useVisits, type Visit, type VisitStatus } from "@/lib/data";
import { insertRows, updateRow } from "@/lib/db";
import { request } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { num, shortDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/visits")({
  head: () => ({
    meta: [
      { title: "Consultations — SalesPos" },
      {
        name: "description",
        content: "The waiting queue, the consultation record, and what was dispensed against it.",
      },
    ],
  }),
  component: Visits,
});

const COLUMNS: { id: VisitStatus; label: string; tone: string }[] = [
  { id: "waiting", label: "Waiting", tone: "border-warning/50" },
  { id: "in_consultation", label: "With the clinician", tone: "border-primary/50" },
  { id: "to_dispense", label: "Waiting for medicine", tone: "border-info/50" },
  { id: "closed", label: "Closed today", tone: "border-border" },
];

function Visits() {
  const queryClient = useQueryClient();
  const { data: visits = [] } = useVisits();
  const { data: patients = [] } = usePatients();
  const [opening, setOpening] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [complaint, setComplaint] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Visit | null>(null);

  const today = new Date().toDateString();
  const board = useMemo(() => {
    return COLUMNS.map((column) => ({
      ...column,
      // Closed visits pile up for ever; only today's belong on a day board.
      visits: visits.filter(
        (v) =>
          v.status === column.id &&
          (column.id !== "closed" || new Date(v.created_at).toDateString() === today),
      ),
    }));
  }, [visits, today]);

  const startVisit = async () => {
    if (!patientId) return toast.error("Choose the patient");
    setBusy(true);
    try {
      await insertRows("visits", {
        patient_id: patientId,
        complaint: complaint.trim(),
        status: "waiting",
      });
      toast.success("Added to the queue");
      setPatientId("");
      setComplaint("");
      setOpening(false);
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open that visit");
    } finally {
      setBusy(false);
    }
  };

  // Kept in sync with the server copy so an open consultation shows what was
  // just prescribed without the dialog being closed and reopened.
  const refreshActive = (id: string) => {
    queryClient.invalidateQueries().then(() => {
      const fresh = (queryClient.getQueryData<Visit[]>(["visits"]) ?? []).find((v) => v.id === id);
      if (fresh) setActive(fresh);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Consultations</h1>
          <p className="text-sm text-muted-foreground">
            Today's queue, and the record of what happened at each visit.
          </p>
        </div>
        <Button onClick={() => setOpening(true)}>
          <UserPlus className="size-4" /> Add to queue
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-4">
        {board.map((column) => (
          <Card key={column.id} className={cn("shadow-[var(--shadow-card)]", column.tone)}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                {column.label}
                <Badge variant="outline" className="text-[10px]">
                  {num(column.visits.length)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {column.visits.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setActive(v)}
                  className="w-full rounded-lg border border-border p-2.5 text-left text-sm transition-colors hover:border-primary"
                >
                  <p className="font-semibold">{v.patient_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {v.patient_number} · {shortDate(v.created_at)}
                  </p>
                  {v.allergies && (
                    <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-destructive">
                      <AlertTriangle className="size-3" /> {v.allergies}
                    </p>
                  )}
                  {v.prescriptions.some((p) => p.outstanding > 0) && (
                    <p className="mt-1 text-[10px] text-info">
                      {num(v.prescriptions.filter((p) => p.outstanding > 0).length)} to dispense
                    </p>
                  )}
                </button>
              ))}
              {column.visits.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">Nobody here.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={opening} onOpenChange={setOpening}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a patient to the queue</DialogTitle>
            <DialogDescription>
              They must be registered first — the card number is how the visit finds them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Patient</Label>
              <Select value={patientId} onValueChange={setPatientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Search by name or card number" />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.patient_number} · {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>What brought them in</Label>
              <Textarea
                value={complaint}
                maxLength={500}
                placeholder="In their own words"
                onChange={(e) => setComplaint(e.target.value)}
              />
            </div>
            <Button className="w-full" disabled={busy} onClick={startVisit}>
              {busy ? "Adding…" : "Add to queue"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Consultation visit={active} onClose={() => setActive(null)} onChanged={refreshActive} />
    </div>
  );
}

/** One visit, open: vitals, findings, what was ordered and what went out. */
function Consultation({
  visit,
  onClose,
  onChanged,
}: {
  visit: Visit | null;
  onClose: () => void;
  onChanged: (id: string) => void;
}) {
  const { user } = useAuth();
  const { data: products = [] } = useProducts();
  const [saving, setSaving] = useState(false);
  const [rx, setRx] = useState({
    medicine: "",
    product_id: "",
    quantity: "",
    dose: "",
    frequency: "",
    duration: "",
  });

  if (!visit) return null;

  const setField = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      await updateRow("visits", visit.id, patch);
      onChanged(visit.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setSaving(false);
    }
  };

  const prescribe = async () => {
    const chosen = products.find((p) => p.id === rx.product_id);
    const name = chosen?.name || rx.medicine.trim();
    if (!name) return toast.error("Which medicine?");
    const quantity = Number(rx.quantity) || 0;
    if (quantity <= 0) return toast.error("How many?");

    try {
      await insertRows("prescriptions", {
        visit_id: visit.id,
        product_id: rx.product_id || null,
        medicine: name,
        quantity_ordered: quantity,
        dose: rx.dose.trim(),
        frequency: rx.frequency.trim(),
        duration: rx.duration.trim(),
      });
      toast.success(`${name} added to the order`);
      setRx({ medicine: "", product_id: "", quantity: "", dose: "", frequency: "", duration: "" });
      onChanged(visit.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add that");
    }
  };

  /** Hand it over, which also takes it off the shelf. */
  const dispense = async (prescriptionId: string, quantity: number) => {
    try {
      await request(`/prescriptions/${prescriptionId}/dispense/`, {
        method: "POST",
        body: JSON.stringify({ quantity }),
      });
      toast.success("Dispensed");
      onChanged(visit.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not dispense that");
    }
  };

  const close = async () => {
    try {
      await request(`/visits/${visit.id}/close/`, { method: "POST", body: JSON.stringify({}) });
      toast.success("Visit closed");
      onChanged(visit.id);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not close the visit");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="size-4" /> {visit.patient_name}
          </DialogTitle>
          <DialogDescription>
            {visit.patient_number} · {shortDate(visit.created_at)} ·{" "}
            <span className="capitalize">{visit.status.replace("_", " ")}</span>
          </DialogDescription>
        </DialogHeader>

        {visit.allergies && (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Allergic to {visit.allergies} — check before prescribing
          </p>
        )}

        {visit.complaint && (
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {visit.complaint}
          </p>
        )}

        <section className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Vitals</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <Vital
              label="Temp °C"
              value={visit.temperature ?? ""}
              onSave={(v) => setField({ temperature: v || null })}
            />
            <Vital
              label="BP"
              value={visit.blood_pressure}
              onSave={(v) => setField({ blood_pressure: v })}
            />
            <Vital
              label="Pulse"
              value={visit.pulse ?? ""}
              onSave={(v) => setField({ pulse: v ? Number(v) : null })}
            />
            <Vital
              label="Weight kg"
              value={visit.weight ?? ""}
              onSave={(v) => setField({ weight: v || null })}
            />
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Examination &amp; diagnosis
          </p>
          <Textarea
            defaultValue={visit.examination}
            placeholder="What was found"
            onBlur={(e) =>
              e.target.value !== visit.examination && setField({ examination: e.target.value })
            }
          />
          <Textarea
            defaultValue={visit.diagnosis}
            placeholder="Diagnosis"
            onBlur={(e) =>
              e.target.value !== visit.diagnosis && setField({ diagnosis: e.target.value })
            }
          />
        </section>

        <section className="space-y-2">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <Pill className="size-3.5" /> Prescription
          </p>

          {visit.prescriptions.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.medicine}</p>
                <p className="text-[11px] text-muted-foreground">
                  {[p.dose, p.frequency, p.duration].filter(Boolean).join(" · ") || "no directions"}
                </p>
              </div>
              <span className="tabular text-xs">
                {num(p.quantity_dispensed)} of {num(p.quantity_ordered)}
              </span>
              {p.outstanding > 0 ? (
                <Button size="sm" variant="outline" onClick={() => dispense(p.id, p.outstanding)}>
                  Dispense {num(p.outstanding)}
                </Button>
              ) : (
                <Badge className="border-0 bg-success text-success-foreground text-[10px]">
                  given
                </Badge>
              )}
            </div>
          ))}

          <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
            <Select
              value={rx.product_id}
              onValueChange={(v) => setRx({ ...rx, product_id: v, medicine: "" })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick from the dispensary" />
              </SelectTrigger>
              <SelectContent>
                {products
                  .filter((p) => !p.is_service)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {num(p.stock_quantity)} left
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="…or write one we do not stock"
              value={rx.medicine}
              onChange={(e) => setRx({ ...rx, medicine: e.target.value, product_id: "" })}
            />
            <div className="grid gap-2 sm:grid-cols-4">
              <Input
                placeholder="Qty"
                type="number"
                min={1}
                value={rx.quantity}
                onChange={(e) => setRx({ ...rx, quantity: e.target.value })}
              />
              <Input
                placeholder="Dose"
                value={rx.dose}
                onChange={(e) => setRx({ ...rx, dose: e.target.value })}
              />
              <Input
                placeholder="Frequency"
                value={rx.frequency}
                onChange={(e) => setRx({ ...rx, frequency: e.target.value })}
              />
              <Input
                placeholder="Duration"
                value={rx.duration}
                onChange={(e) => setRx({ ...rx, duration: e.target.value })}
              />
            </div>
            <Button size="sm" variant="outline" className="w-full" onClick={prescribe}>
              <ClipboardPlus className="size-3.5" /> Add to the order
            </Button>
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-2">
          {visit.status !== "closed" && (
            <>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => setField({ status: "in_consultation", clinician: user?.id ?? null })}
              >
                Start consultation
              </Button>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => setField({ status: "to_dispense" })}
              >
                Send to dispensary
              </Button>
              <Button onClick={close}>Close visit</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One vital sign, saved when the field is left rather than on every keystroke. */
function Vital({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | number;
  onSave: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase text-muted-foreground">{label}</Label>
      <Input
        className="h-8"
        defaultValue={String(value ?? "")}
        onBlur={(e) => e.target.value !== String(value ?? "") && onSave(e.target.value)}
      />
    </div>
  );
}
