/**
 * The owner's view of who owes money — one row per person, not per debt.
 *
 * The debtor ledger answers "what is outstanding?"; this answers "who is it
 * with, and how do I reach them?". That is why it carries the details the
 * counter collected at the point of credit — the national ID, both numbers,
 * where they trade and where they sleep — and why it lives behind the owner
 * check rather than on the shop floor.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, IdCard, MapPin, Phone, Search, Users } from "lucide-react";
import { debtStatus, outstanding, type Customer, type Debt } from "@/lib/data";
import { ugx, num, shortDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Line = {
  customer: Customer;
  balance: number;
  overdueBalance: number;
  openDebts: number;
  /** The date the oldest unpaid debt fell, or falls, due. */
  oldestDue: string | null;
};

export function DebtorOverview({ customers, debts }: { customers: Customer[]; debts: Debt[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Line | null>(null);

  const lines = useMemo<Line[]>(() => {
    return (
      customers
        .map((customer) => {
          const theirs = debts.filter((d) => d.customer_id === customer.id);
          const live = theirs.filter((d) => debtStatus(d) !== "cleared");
          const overdue = live.filter((d) => debtStatus(d) === "overdue");
          const dues = live.map((d) => d.due_date).sort();
          return {
            customer,
            balance: live.reduce((a, d) => a + outstanding(d), 0),
            overdueBalance: overdue.reduce((a, d) => a + outstanding(d), 0),
            openDebts: live.length,
            oldestDue: dues[0] ?? null,
          };
        })
        // Someone who has never taken credit is a customer, not a debtor.
        .filter((line) => line.openDebts > 0)
        .sort((a, b) => b.overdueBalance - a.overdueBalance || b.balance - a.balance)
    );
  }, [customers, debts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((line) => {
      const c = line.customer;
      return [c.name, c.phone, c.alt_phone, c.nin, c.location, c.residence, c.occupation]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [lines, query]);

  const totals = useMemo(
    () => ({
      people: lines.length,
      balance: lines.reduce((a, l) => a + l.balance, 0),
      overdue: lines.reduce((a, l) => a + l.overdueBalance, 0),
      overduePeople: lines.filter((l) => l.overdueBalance > 0).length,
      unidentified: lines.filter((l) => !l.customer.nin).length,
    }),
    [lines],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile icon={Users} label="People on credit" value={num(totals.people)} />
        <Tile icon={Phone} label="Total owed" value={ugx(totals.balance)} />
        <Tile
          icon={AlertTriangle}
          label={`Overdue · ${totals.overduePeople} people`}
          value={ugx(totals.overdue)}
          tone="danger"
        />
        <Tile
          icon={IdCard}
          label="Without a national ID"
          value={num(totals.unidentified)}
          tone={totals.unidentified ? "warning" : "muted"}
        />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by name, phone, NIN or location"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Debtor</TableHead>
                <TableHead>National ID</TableHead>
                <TableHead>Where to find them</TableHead>
                <TableHead className="text-right">Owed</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead>Oldest due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((line) => (
                <TableRow
                  key={line.customer.id}
                  className={cn("cursor-pointer", line.overdueBalance > 0 && "bg-destructive/5")}
                  onClick={() => setOpen(line)}
                >
                  <TableCell>
                    <p className="font-medium">{line.customer.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {line.customer.phone || "No contact"}
                      {line.openDebts > 1 && ` · ${line.openDebts} open debts`}
                    </p>
                  </TableCell>
                  <TableCell className="text-xs">
                    {line.customer.nin || (
                      <Badge variant="outline" className="border-warning/50 text-[10px]">
                        not on file
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                    {[line.customer.residence, line.customer.location]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold">
                    {ugx(line.balance)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "tabular text-right",
                      line.overdueBalance > 0 && "font-semibold text-destructive",
                    )}
                  >
                    {line.overdueBalance > 0 ? ugx(line.overdueBalance) : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {line.oldestDue ? shortDate(line.oldestDue) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    {lines.length === 0
                      ? "Nobody is on credit right now."
                      : "No debtor matches that search."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DebtorCard line={open} debts={debts} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Everything the counter recorded about one debtor, plus their open debts. */
function DebtorCard({
  line,
  debts,
  onClose,
}: {
  line: Line | null;
  debts: Debt[];
  onClose: () => void;
}) {
  const c = line?.customer;
  const theirs = line
    ? debts
        .filter((d) => d.customer_id === line.customer.id && debtStatus(d) !== "cleared")
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
    : [];

  return (
    <Dialog open={!!line} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{c?.name}</DialogTitle>
          <DialogDescription>
            {ugx(line?.balance ?? 0)} outstanding across {line?.openDebts ?? 0} debt
            {line?.openDebts === 1 ? "" : "s"}
            {line?.overdueBalance ? ` · ${ugx(line.overdueBalance)} overdue` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Detail icon={Phone} label="Phone" value={c?.phone} />
          <Detail icon={Phone} label="Other phone" value={c?.alt_phone} />
          <Detail icon={IdCard} label="National ID (NIN)" value={c?.nin} />
          <Detail icon={IdCard} label="Occupation" value={c?.occupation} />
          <Detail icon={MapPin} label="Location / trading area" value={c?.location} />
          <Detail icon={MapPin} label="Residing place" value={c?.residence} />
          <Detail icon={Users} label="Guarantor" value={c?.guarantor_name} />
          <Detail icon={Phone} label="Guarantor phone" value={c?.guarantor_phone} />
        </div>

        {Number(c?.credit_limit) > 0 && (
          <p
            className={cn(
              "rounded-lg border px-3 py-2 text-xs",
              (line?.balance ?? 0) > Number(c?.credit_limit)
                ? "border-destructive/40 bg-destructive/10 font-semibold text-destructive"
                : "border-border text-muted-foreground",
            )}
          >
            Credit limit {ugx(Number(c?.credit_limit))} · currently owing {ugx(line?.balance ?? 0)}
          </p>
        )}

        {c?.notes && <p className="text-sm text-muted-foreground">{c.notes}</p>}

        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Items</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {theirs.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="max-w-[240px] truncate text-xs">
                    {d.items_summary}
                  </TableCell>
                  <TableCell className="text-xs">{shortDate(d.issue_date)}</TableCell>
                  <TableCell
                    className={cn(
                      "text-xs",
                      debtStatus(d) === "overdue" && "font-semibold text-destructive",
                    )}
                  >
                    {shortDate(d.due_date)}
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold">
                    {ugx(outstanding(d))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" /> {label}
      </p>
      <p className={cn("mt-0.5 text-sm", !value && "text-muted-foreground")}>
        {value || "Not recorded"}
      </p>
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  tone = "muted",
}: {
  icon: typeof Users;
  label: string;
  value: string;
  tone?: "muted" | "danger" | "warning";
}) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="p-4">
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          <Icon className="size-3" /> {label}
        </p>
        <p
          className={cn(
            "tabular mt-1 text-xl font-extrabold",
            tone === "danger" && "text-destructive",
            tone === "warning" && "text-warning-foreground",
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
