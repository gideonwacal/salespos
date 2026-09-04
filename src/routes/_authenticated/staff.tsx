import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { useStaff } from "@/lib/data";
import { shortDate } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { type AppRole } from "@/lib/demo";
import { addStaff, staffUserId, updateStaff, type StaffRow } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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

export const Route = createFileRoute("/_authenticated/staff")({
  head: () => ({
    meta: [
      { title: "Users & Roles — SalesPos" },
      {
        name: "description",
        content: "Create logins for the people who run your shop and set what each of them can do.",
      },
      { property: "og:title", content: "Users & Roles — SalesPos" },
      {
        property: "og:description",
        content: "Create logins for the people who run your shop and set their access level.",
      },
    ],
  }),
  component: Staff,
});

const blank = { full_name: "", email: "", phone: "", password: "", role: "manager" as AppRole };

function Staff() {
  const { data: staff = [], refetch } = useStaff() as {
    data: StaffRow[] | undefined;
    refetch: () => void;
  };
  const { isOwner, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);

  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.full_name.trim()) return toast.error("Enter the person's name");
    if (!form.email.trim()) return toast.error("Enter an email they will sign in with");
    // Django's validators reject anything shorter, so stop it here rather than
    // letting the server bounce it back.
    if (form.password.length < 8) return toast.error("Password must be at least 8 characters");
    setBusy(true);
    try {
      await addStaff({
        email: form.email,
        password: form.password,
        fullName: form.full_name.trim(),
        phone: form.phone.trim(),
        role: form.role,
      });
      toast.success(`${form.full_name} can now sign in with that email and password`);
      setForm(blank);
      setOpen(false);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the user");
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (id: string, role: AppRole) => {
    try {
      await updateStaff(id, { role });
      toast.success("Role updated");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the role");
    }
  };

  const toggleActive = async (id: string, active: boolean) => {
    try {
      await updateStaff(id, { active });
      toast.success(active ? "Access restored" : "Access revoked");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change access");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Users & roles</h1>
          <p className="text-sm text-muted-foreground">
            Owners see the financials; sales staff run the counter. Staff never sign up on their
            own — you create their login here.
          </p>
        </div>
        {isOwner && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="size-4" /> Add user
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a team member</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tm-name">Full name</Label>
                  <Input
                    id="tm-name"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="tm-email">Email (their username)</Label>
                    <Input
                      id="tm-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tm-phone">Phone</Label>
                    <Input
                      id="tm-phone"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="tm-pass">Temporary password</Label>
                    <Input
                      id="tm-pass"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Select
                      value={form.role}
                      onValueChange={(v) => setForm({ ...form, role: v as AppRole })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manager">Sales staff / Manager</SelectItem>
                        <SelectItem value="owner">Owner / Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button className="w-full" onClick={submit} disabled={busy}>
                  Create login
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Share the email and temporary password with them — they sign in directly, no
                  sign-up needed.
                </p>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">Team members ({staff.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                {isOwner && <TableHead className="text-right">Access</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((s) => (
                <TableRow key={s.id} className={s.active === false ? "opacity-50" : ""}>
                  <TableCell className="font-medium">{s.full_name || "Unnamed user"}</TableCell>
                  <TableCell className="text-muted-foreground">{s.email}</TableCell>
                  <TableCell className="text-muted-foreground">{s.phone || "—"}</TableCell>
                  <TableCell>
                    {isOwner && staffUserId(s) !== user?.id ? (
                      <Select
                        value={s.role}
                        onValueChange={(v) => changeRole(s.id, v as AppRole)}
                      >
                        <SelectTrigger className="h-8 w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manager">Sales staff</SelectItem>
                          <SelectItem value="owner">Owner / Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge
                        variant="outline"
                        className={
                          s.role === "owner" ? "border-success bg-success-soft text-success" : ""
                        }
                      >
                        {s.role === "owner" ? "Owner / Admin" : "Sales staff"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{shortDate(s.created_at)}</TableCell>
                  {isOwner && (
                    <TableCell className="text-right">
                      {staffUserId(s) === user?.id ? (
                        <span className="text-xs text-muted-foreground">You</span>
                      ) : (
                        <Button
                          size="sm"
                          variant={s.active === false ? "outline" : "ghost"}
                          onClick={() => toggleActive(s.id, s.active === false)}
                        >
                          {s.active === false ? "Restore" : "Revoke"}
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
