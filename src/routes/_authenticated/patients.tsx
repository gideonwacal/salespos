/**
 * The people a clinic treats.
 *
 * A patient record is not a customer record with different words on it. It
 * carries a card number that gets called out in a waiting room, an age that
 * doses are worked out from, a next of kin, and allergies — which sit on their
 * own line everywhere a patient appears, because they are read before anything
 * is prescribed.
 *
 * Plenty of patients do not know their date of birth, so the form takes either
 * that or a stated age and does not insist on the one it was not offered.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Search, UserPlus, Users } from "lucide-react";
import { usePatients, useVisits, type Patient } from "@/lib/data";
import { insertRows } from "@/lib/db";
import { shortDate, num } from "@/lib/format";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/patients")({
  head: () => ({
    meta: [
      { title: "Patients — SalesPos" },
      {
        name: "description",
        content: "Register patients and open their history, allergies and past visits.",
      },
    ],
  }),
  component: Patients,
});

const BLANK = {
  full_name: "",
  sex: "",
  stated_age: "",
  date_of_birth: "",
  phone: "",
  village: "",
  nin: "",
  next_of_kin_name: "",
  next_of_kin_phone: "",
  allergies: "",
  notes: "",
};

function Patients() {
  const queryClient = useQueryClient();
  const { data: patients = [] } = usePatients();
  const { data: visits = [] } = useVisits();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<Patient | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) =>
      [p.full_name, p.patient_number, p.phone, p.village, p.nin]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q)),
    );
  }, [patients, query]);

  const save = async () => {
    if (!form.full_name.trim()) return toast.error("The patient's name is required");
    setBusy(true);
    try {
      await insertRows("patients", {
        full_name: form.full_name.trim(),
        sex: form.sex,
        stated_age: form.stated_age ? Number(form.stated_age) : null,
        date_of_birth: form.date_of_birth || null,
        phone: form.phone.trim(),
        village: form.village.trim(),
        nin: form.nin.trim().toUpperCase(),
        next_of_kin_name: form.next_of_kin_name.trim(),
        next_of_kin_phone: form.next_of_kin_phone.trim(),
        allergies: form.allergies.trim(),
        notes: form.notes.trim(),
      });
      toast.success("Patient registered");
      setForm({ ...BLANK });
      setOpen(false);
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not register that patient");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Patients</h1>
          <p className="text-sm text-muted-foreground">
            {num(patients.length)} registered. Search by name, card number, phone or village.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <UserPlus className="size-4" /> Register a patient
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Name, card number, phone or village"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Card no.</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Allergies</TableHead>
                <TableHead className="text-right">Visits</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => setViewing(p)}>
                  <TableCell className="font-mono text-xs">{p.patient_number}</TableCell>
                  <TableCell>
                    <p className="font-medium">{p.full_name}</p>
                    <p className="text-[11px] capitalize text-muted-foreground">
                      {[p.sex, p.village].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </TableCell>
                  <TableCell className="tabular">{p.age ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.phone || "—"}</TableCell>
                  <TableCell>
                    {p.allergies ? (
                      <Badge className="border-0 bg-destructive text-destructive-foreground text-[10px]">
                        <AlertTriangle className="size-3" /> {p.allergies.slice(0, 24)}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">none recorded</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">{num(p.visit_count)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    {patients.length === 0 ? "Nobody registered yet." : "No patient matches that."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Register a patient</DialogTitle>
            <DialogDescription>
              The card number is issued automatically. Only the name is required — the rest can be
              filled in as it is learnt.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input
                value={form.full_name}
                maxLength={200}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Sex</Label>
                <Select value={form.sex} onValueChange={(v) => setForm({ ...form, sex: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Age</Label>
                <Input
                  type="number"
                  min={0}
                  max={130}
                  placeholder="if not known exactly"
                  value={form.stated_age}
                  onChange={(e) => setForm({ ...form, stated_age: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Date of birth</Label>
                <Input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Village or address</Label>
                <Input
                  value={form.village}
                  onChange={(e) => setForm({ ...form, village: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Next of kin</Label>
                <Input
                  value={form.next_of_kin_name}
                  onChange={(e) => setForm({ ...form, next_of_kin_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Next of kin phone</Label>
                <Input
                  value={form.next_of_kin_phone}
                  onChange={(e) => setForm({ ...form, next_of_kin_phone: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-destructive">Allergies</Label>
              <Input
                value={form.allergies}
                placeholder="Penicillin, sulfa… — read before anything is prescribed"
                onChange={(e) => setForm({ ...form, allergies: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                maxLength={500}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <Button className="w-full" disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Register patient"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PatientCard
        patient={viewing}
        visits={visits.filter((v) => v.patient_id === viewing?.id)}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}

/** Everything known about one patient, and every time they have been seen. */
function PatientCard({
  patient,
  visits,
  onClose,
}: {
  patient: Patient | null;
  visits: ReturnType<typeof useVisits>["data"];
  onClose: () => void;
}) {
  const seen = visits ?? [];
  return (
    <Dialog open={!!patient} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" /> {patient?.full_name}
          </DialogTitle>
          <DialogDescription>
            Card {patient?.patient_number} · {patient?.age ?? "age not recorded"}
            {patient?.sex ? ` · ${patient.sex}` : ""}
          </DialogDescription>
        </DialogHeader>

        {patient?.allergies && (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Allergic to {patient.allergies}
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <Fact label="Phone" value={patient?.phone} />
          <Fact label="Village" value={patient?.village} />
          <Fact label="Next of kin" value={patient?.next_of_kin_name} />
          <Fact label="Next of kin phone" value={patient?.next_of_kin_phone} />
          <Fact label="National ID" value={patient?.nin} />
          <Fact label="Registered" value={patient ? shortDate(patient.created_at) : ""} />
        </div>

        {patient?.notes && <p className="text-sm text-muted-foreground">{patient.notes}</p>}

        <Card className="shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {num(seen.length)} visit{seen.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-3 pt-0">
            {seen.map((v) => (
              <div key={v.id} className="rounded-lg border border-border p-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{shortDate(v.created_at)}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {v.status.replace("_", " ")}
                  </Badge>
                </div>
                {v.diagnosis && <p className="mt-1 text-muted-foreground">{v.diagnosis}</p>}
                {v.prescriptions.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {v.prescriptions.map((p) => p.medicine).join(", ")}
                  </p>
                )}
              </div>
            ))}
            {seen.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No visits recorded yet.
              </p>
            )}
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm ${value ? "" : "text-muted-foreground"}`}>{value || "Not recorded"}</p>
    </div>
  );
}
