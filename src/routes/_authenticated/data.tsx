import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Upload, CircleAlert, CircleCheck } from "lucide-react";
import { insertRows, selectRows, addStaff } from "@/lib/db";
import { datasetsFor, EXPORT_ONLY } from "@/lib/datasets";
import {
  detectColumns,
  download,
  isSupportedFile,
  mapRows,
  readTable,
  stamp,
  templateCsv,
  toCsv,
  type RowResult,
  type TransferSchema,
} from "@/lib/transfer";
import { useIndustry } from "@/hooks/useIndustry";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/data")({
  head: () => ({
    meta: [
      { title: "Import & Export — SalesPos" },
      {
        name: "description",
        content:
          "Bring your existing spreadsheets into SalesPos and export any list back out to Excel.",
      },
    ],
  }),
  component: DataTransfer,
});

type Stage =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "preview"; rows: RowResult[]; matched: string[]; missing: string[]; file: string }
  | { step: "saving"; done: number; total: number };

function DataTransfer() {
  const industry = useIndustry();
  const { isOwner } = useAuth();
  const queryClient = useQueryClient();
  const datasets = useMemo(() => datasetsFor(industry), [industry]);

  const [active, setActive] = useState<TransferSchema>(datasets[0]);
  const [stage, setStage] = useState<Stage>({ step: "idle" });
  const fileInput = useRef<HTMLInputElement>(null);

  const importable = !EXPORT_ONLY.has(active.id);
  // Staff and money-shaped lists are the owner's to load.
  const mayImport = importable && isOwner;

  const choose = (schema: TransferSchema) => {
    setActive(schema);
    setStage({ step: "idle" });
  };

  /* ---------------- export ---------------- */

  const exportRows = async () => {
    try {
      const rows = await selectRows<Record<string, unknown>>(active.table);
      if (!rows.length) {
        toast.error(`There is nothing in ${active.label} to export yet`);
        return;
      }
      download(stamp(active.id), toCsv(active, rows));
      toast.success(`${rows.length} ${active.label.toLowerCase()} exported`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not export");
    }
  };

  const exportTemplate = () => {
    download(stamp(`${active.id}-template`), templateCsv(active));
    toast.success("Template downloaded — fill it in and import it back");
  };

  /* ---------------- import ---------------- */

  const inspect = async (file: File) => {
    if (!isSupportedFile(file.name)) {
      toast.error("Use an Excel (.xlsx) or CSV file");
      return;
    }
    setStage({ step: "checking" });
    try {
      const raw = await readTable(file);
      if (!raw.length) {
        toast.error("That file has no rows under its headings");
        setStage({ step: "idle" });
        return;
      }
      const { matched, missing } = detectColumns(active, raw);
      if (missing.length) {
        toast.error(`Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
      }
      setStage({
        step: "preview",
        rows: mapRows(active, raw),
        matched,
        missing,
        file: file.name,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that file");
      setStage({ step: "idle" });
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const commit = async () => {
    if (stage.step !== "preview") return;
    const good = stage.rows.filter((r): r is Extract<RowResult, { ok: true }> => r.ok);
    if (!good.length) return;

    setStage({ step: "saving", done: 0, total: good.length });
    let saved = 0;
    const failures: string[] = [];

    for (const row of good) {
      try {
        // Staff go through addStaff so they get a real login and the seat
        // limit is honoured, exactly as if they were added on the Staff page.
        if (active.id === "staff") {
          await addStaff({
            email: String(row.value.email),
            password: String(row.value.password),
            fullName: String(row.value.full_name),
            phone: String(row.value.phone ?? ""),
            role: row.value.role === "owner" ? "owner" : "manager",
          });
        } else {
          await insertRows(active.table, row.value as Record<string, unknown>);
        }
        saved += 1;
      } catch (err) {
        failures.push(
          `Row ${row.line}: ${err instanceof Error ? err.message : "could not be saved"}`,
        );
      }
      setStage({ step: "saving", done: saved + failures.length, total: good.length });
    }

    queryClient.invalidateQueries();
    setStage({ step: "idle" });

    if (saved) toast.success(`${saved} ${active.label.toLowerCase()} imported`);
    if (failures.length) {
      toast.error(`${failures.length} row${failures.length > 1 ? "s" : ""} could not be saved`, {
        description: failures.slice(0, 3).join(" · "),
      });
    }
  };

  const okCount = stage.step === "preview" ? stage.rows.filter((r) => r.ok).length : 0;
  const badRows = stage.step === "preview" ? stage.rows.filter((r) => !r.ok) : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Import &amp; export</h1>
        <p className="text-sm text-muted-foreground">
          Bring an existing spreadsheet in, or take any list out to Excel. Accepts .xlsx, .xls
          and .csv.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-base">Category</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-2">
            {datasets.map((schema) => (
              <button
                key={schema.id}
                onClick={() => choose(schema)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  schema.id === active.id
                    ? "bg-primary/10 font-semibold text-primary"
                    : "hover:bg-muted",
                )}
              >
                <span>{schema.label}</span>
                {EXPORT_ONLY.has(schema.id) && (
                  <Badge variant="outline" className="text-[10px]">
                    export
                  </Badge>
                )}
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader>
              <CardTitle className="text-base">{active.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{active.description}</p>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={exportRows}>
                  <Download className="size-4" /> Export to CSV
                </Button>
                {importable && (
                  <Button variant="outline" onClick={exportTemplate}>
                    <FileSpreadsheet className="size-4" /> Download template
                  </Button>
                )}
                {mayImport && (
                  <Button onClick={() => fileInput.current?.click()} disabled={stage.step === "checking"}>
                    <Upload className="size-4" />
                    {stage.step === "checking" ? "Reading…" : "Import a spreadsheet"}
                  </Button>
                )}
              </div>

              {importable && !isOwner && (
                <p className="text-sm text-muted-foreground">
                  Only the owner can import data. You can still export any list.
                </p>
              )}

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Columns
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {active.columns.map((column) => (
                    <Badge
                      key={column.key}
                      variant="outline"
                      className={column.required ? "border-primary/50 text-primary" : ""}
                    >
                      {column.label}
                      {column.required && " *"}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Headings are matched loosely — &ldquo;Qty&rdquo;, &ldquo;Stock&rdquo; and
                  &ldquo;Quantity in stock&rdquo; all find the same column, and the order does not
                  matter.
                </p>
              </div>

              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && inspect(e.target.files[0])}
              />
            </CardContent>
          </Card>

          {stage.step === "saving" && (
            <Card className="shadow-[var(--shadow-card)]">
              <CardContent className="pt-6 text-sm">
                Importing… {stage.done} of {stage.total}
              </CardContent>
            </Card>
          )}

          {stage.step === "preview" && (
            <Card className="shadow-[var(--shadow-card)]">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  Preview of {stage.file}
                  <Badge className="border-0 bg-success text-success-foreground">
                    <CircleCheck className="size-3" /> {okCount} ready
                  </Badge>
                  {badRows.length > 0 && (
                    <Badge className="border-0 bg-destructive text-destructive-foreground">
                      <CircleAlert className="size-3" /> {badRows.length} to fix
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Matched columns: {stage.matched.join(", ") || "none"}
                </p>

                {badRows.length > 0 && (
                  <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                    <p className="text-sm font-semibold text-destructive">
                      These rows will be skipped
                    </p>
                    <ul className="space-y-0.5 text-sm text-muted-foreground">
                      {badRows.slice(0, 8).map((row) => (
                        <li key={row.line}>
                          Row {row.line}: {"error" in row ? row.error : ""}
                        </li>
                      ))}
                      {badRows.length > 8 && <li>…and {badRows.length - 8} more</li>}
                    </ul>
                  </div>
                )}

                {okCount > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          {active.columns.map((c) => (
                            <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left font-semibold">
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stage.rows
                          .filter((r): r is Extract<RowResult, { ok: true }> => r.ok)
                          .slice(0, 5)
                          .map((row) => (
                            <tr key={row.line} className="border-t border-border">
                              {active.columns.map((c) => (
                                <td key={c.key} className="whitespace-nowrap px-3 py-2">
                                  {String(row.value[c.key] ?? "")}
                                </td>
                              ))}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {okCount > 5 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        Showing the first 5 of {okCount} rows.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setStage({ step: "idle" })}>
                    Cancel
                  </Button>
                  <Button onClick={commit} disabled={!okCount}>
                    Import {okCount} {active.label.toLowerCase()}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
