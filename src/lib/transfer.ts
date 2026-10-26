/**
 * Spreadsheet import and export.
 *
 * One engine for every dataset. A `TransferSchema` says what the columns are,
 * how to read a row and how to write one, and the dialog does the rest — so
 * adding a new importable category means adding a schema, not a new UI.
 *
 * Reading accepts what shopkeepers actually have: .xlsx and .xls straight out
 * of Excel, plus .csv and tab-separated exports. Writing is CSV, because it
 * opens everywhere without a library on the other end.
 */

import * as XLSX from "xlsx";

export type RawRow = Record<string, string>;

export type ColumnKind = "text" | "number" | "money" | "integer" | "date" | "boolean";

export type TransferColumn = {
  /** Key in the payload sent to the API. */
  key: string;
  /** Header written to exports and templates. */
  label: string;
  kind: ColumnKind;
  required?: boolean;
  /** Other spellings accepted on import, lower-cased. */
  aliases?: string[];
  /** Used when the cell is blank. */
  fallback?: unknown;
  /** Shown in the downloadable template's example row. */
  example?: string;
};

/** Lists an export may need to join against to turn ids into names. */
export type ExportContext = {
  products: Record<string, unknown>[];
  customers: Record<string, unknown>[];
};

export type TransferSchema = {
  id: string;
  label: string;
  /** Table name understood by lib/db. */
  table: string;
  description: string;
  columns: TransferColumn[];
  /**
   * The column an export is filtered by date on. Set it and the page offers a
   * period — which is what makes "last month's stock" a download rather than a
   * spreadsheet the owner has to trim by hand.
   */
  dateKey?: string;
  /** Extra checks across the whole row; return a message to reject it. */
  validateRow?: (row: Record<string, unknown>, raw: RawRow) => string | null;
  /**
   * Last pass over the rows before they are written out. A stock movement
   * stores a product id, and nobody analyses a spreadsheet of UUIDs.
   */
  decorate?: (
    rows: Record<string, unknown>[],
    context: ExportContext,
  ) => Record<string, unknown>[];
};

/** The date part of a value that may be a date or a full timestamp. */
export function dayOf(value: unknown): string {
  const text = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

/** Rows whose `dateKey` falls inside the period. Undated rows are kept: a
 * missing timestamp is a data gap, and silently dropping it loses stock. */
export function withinPeriod(
  schema: TransferSchema,
  rows: Record<string, unknown>[],
  from: string,
  to: string,
): Record<string, unknown>[] {
  if (!schema.dateKey || (!from && !to)) return rows;
  return rows.filter((row) => {
    const day = dayOf(row[schema.dateKey as string]);
    if (!day) return true;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* reading                                                             */
/* ------------------------------------------------------------------ */

/** True for the extensions the reader can open. */
export function isSupportedFile(name: string) {
  return /\.(xlsx|xlsm|xls|csv|tsv|txt)$/i.test(name);
}

/**
 * Read the first sheet of a workbook, or a delimited text file, into rows
 * keyed by their header.
 *
 * Everything comes back as a trimmed string; coercion happens later against the
 * schema, so a number formatted "1,200" in Excel is handled in one place.
 */
export async function readTable(file: File): Promise<RawRow[]> {
  const data = await file.arrayBuffer();
  // SheetJS reads CSV and TSV too, so one path covers every accepted format
  // and we inherit its quoting and encoding handling rather than writing ours.
  const book = XLSX.read(data, { type: "array", cellDates: true, raw: false });

  const first = book.SheetNames[0];
  if (!first) throw new Error("That file has no sheets in it.");

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[first], {
    defval: "",
    raw: false,
    blankrows: false,
  });

  return rows.map((row) => {
    const out: RawRow = {};
    for (const [key, value] of Object.entries(row)) {
      out[normaliseHeader(key)] = value == null ? "" : String(value).trim();
    }
    return out;
  });
}

/** "Unit Selling Price (UGX)" -> "unit selling price". */
function normaliseHeader(header: string) {
  return header
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every spelling of a column we will answer to. */
function keysFor(column: TransferColumn) {
  return [
    normaliseHeader(column.key),
    normaliseHeader(column.label),
    ...(column.aliases ?? []).map(normaliseHeader),
  ];
}

function pick(raw: RawRow, column: TransferColumn): string {
  for (const key of keysFor(column)) {
    const value = raw[key];
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

const TRUE_WORDS = ["true", "yes", "y", "1", "on"];
const FALSE_WORDS = ["false", "no", "n", "0", "off", ""];

function coerce(value: string, column: TransferColumn): unknown {
  if (value === "") return column.fallback ?? defaultFor(column.kind);

  switch (column.kind) {
    case "number":
    case "money":
    case "integer": {
      // Excel exports often carry thousands separators and a currency prefix.
      const cleaned = value.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
      // Stripping "not a number" leaves "", and Number("") is 0 — which would
      // quietly turn a typo into a real quantity. Demand at least one digit.
      if (!/[0-9]/.test(cleaned)) throw new Error(`"${value}" is not a number`);
      const parsed = Number(cleaned);
      if (!Number.isFinite(parsed)) throw new Error(`"${value}" is not a number`);
      return column.kind === "integer" ? Math.round(parsed) : parsed;
    }
    case "boolean": {
      const word = value.toLowerCase();
      if (TRUE_WORDS.includes(word)) return true;
      if (FALSE_WORDS.includes(word)) return false;
      throw new Error(`"${value}" is not a yes/no value`);
    }
    case "date": {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new Error(`"${value}" is not a date`);
      return date.toISOString().slice(0, 10);
    }
    default:
      return value;
  }
}

function defaultFor(kind: ColumnKind) {
  if (kind === "boolean") return false;
  if (kind === "text") return "";
  if (kind === "date") return null;
  return 0;
}

export type RowResult =
  | { ok: true; line: number; value: Record<string, unknown> }
  | { ok: false; line: number; error: string };

/** Turn raw sheet rows into API payloads, collecting per-row errors. */
export function mapRows(schema: TransferSchema, rows: RawRow[]): RowResult[] {
  return rows.map((raw, index) => {
    // +2: one for the header, one because humans count from 1.
    const line = index + 2;
    const value: Record<string, unknown> = {};

    try {
      for (const column of schema.columns) {
        const cell = pick(raw, column);
        if (column.required && cell === "") {
          throw new Error(`${column.label} is required`);
        }
        value[column.key] = coerce(cell, column);
      }

      const problem = schema.validateRow?.(value, raw);
      if (problem) throw new Error(problem);

      return { ok: true, line, value };
    } catch (err) {
      return {
        ok: false,
        line,
        error: err instanceof Error ? err.message : "Could not read this row",
      };
    }
  });
}

/** Which of the schema's columns this file actually supplies. */
export function detectColumns(schema: TransferSchema, rows: RawRow[]) {
  const present = new Set(Object.keys(rows[0] ?? {}));
  const matched: string[] = [];
  const missing: string[] = [];

  for (const column of schema.columns) {
    if (keysFor(column).some((k) => present.has(k))) matched.push(column.label);
    else if (column.required) missing.push(column.label);
  }
  return { matched, missing };
}

/* ------------------------------------------------------------------ */
/* writing                                                             */
/* ------------------------------------------------------------------ */

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  // Quote anything that could otherwise break the row apart, and double any
  // quotes inside it — the rule Excel and Sheets both follow.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(schema: TransferSchema, rows: Record<string, unknown>[]): string {
  const header = schema.columns.map((c) => csvCell(c.label)).join(",");
  const body = rows.map((row) =>
    schema.columns.map((c) => csvCell(row[c.key] ?? "")).join(","),
  );
  return [header, ...body].join("\r\n");
}

/** A header row plus one example, so people can see the shape expected. */
export function templateCsv(schema: TransferSchema): string {
  const header = schema.columns.map((c) => csvCell(c.label)).join(",");
  const example = schema.columns.map((c) => csvCell(c.example ?? "")).join(",");
  return [header, example].join("\r\n");
}

/** Plain words for what a column will accept. */
function kindHint(kind: ColumnKind): string {
  switch (kind) {
    case "money":
      return "A number. No commas, no UGX — just 4200.";
    case "integer":
      return "A whole number.";
    case "number":
      return "A number. Parts are fine: 0.25.";
    case "date":
      return "A date, like 2026-03-14.";
    case "boolean":
      return "yes or no.";
    default:
      return "Text.";
  }
}

/**
 * The guide sheet that rides along with every template.
 *
 * A bare header row is only obvious to whoever wrote it. The questions a shop
 * actually has — is this one required, does the price go in with commas, what
 * happens to a row I get wrong — are answered here rather than in a reply to
 * a support message.
 */
function guideSheet(schema: TransferSchema, businessName: string): string[][] {
  const rows: string[][] = [
    [`${schema.label} — import template`],
    [businessName],
    [],
    [schema.description],
    [],
    ["How to use this file"],
    ["1.", `Open the “${schema.label}” sheet.`],
    ["2.", "Replace the example rows with your own. Keep the headings as they are."],
    ["3.", "Save the file, then upload it on Import & Export."],
    [],
    ["You will see a preview before anything is saved. Rows with a problem are"],
    ["listed with the reason, and the rest still go in — nothing is all-or-nothing."],
    [],
    ["Columns"],
    ["Heading", "Needed?", "What goes in it", "Example"],
  ];
  for (const column of schema.columns) {
    rows.push([
      column.label,
      column.required ? "Required" : "Optional",
      kindHint(column.kind),
      column.example ?? "",
    ]);
  }
  rows.push([]);
  rows.push(["Headings we also recognise, so an existing sheet often imports as it is:"]);
  for (const column of schema.columns) {
    if (column.aliases?.length) {
      rows.push([column.label, column.aliases.join(", ")]);
    }
  }
  return rows;
}

/** The example rows, as a grid. */
function exampleGrid(schema: TransferSchema, examples: string[][] = []): string[][] {
  const header = schema.columns.map((c) => c.label);
  const fallback = [schema.columns.map((c) => c.example ?? "")];
  return [header, ...(examples.length ? examples : fallback)];
}

function autoWidths(rows: string[][]) {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.min(60, Math.max(widths[i] ?? 10, String(cell ?? "").length + 2));
    });
  }
  return widths.map((wch) => ({ wch }));
}

function addSheet(book: XLSX.WorkBook, name: string, rows: string[][]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = autoWidths(rows);
  // Excel refuses sheet names over 31 characters and a handful of symbols.
  XLSX.utils.book_append_sheet(book, sheet, name.replace(/[\\/?*[\]:]/g, "").slice(0, 31));
}

/**
 * One dataset as a workbook: a guide sheet, then the sheet to fill in.
 *
 * Returned as bytes rather than written straight out, so the caller decides
 * the filename and the download behaves like every other one on the page.
 */
export function templateWorkbook(
  schema: TransferSchema,
  businessName: string,
  examples: string[][] = [],
): ArrayBuffer {
  const book = XLSX.utils.book_new();
  addSheet(book, "How to fill this in", guideSheet(schema, businessName));
  addSheet(book, schema.label, exampleGrid(schema, examples));
  return XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

/**
 * Everything a new shop needs, in one file.
 *
 * Separate downloads meant filling four spreadsheets and remembering which
 * went where. One workbook with a sheet each, in the order they have to be
 * imported, is the same work without the bookkeeping.
 */
export function starterWorkbook(
  schemas: TransferSchema[],
  businessName: string,
  examplesFor: (schema: TransferSchema) => string[][] = () => [],
): ArrayBuffer {
  const book = XLSX.utils.book_new();
  const intro: string[][] = [
    ["SalesPos starter pack"],
    [businessName],
    [],
    ["One sheet per list. Fill in what you have — a sheet you leave empty is skipped."],
    [],
    ["Import them in this order, because the later ones refer to the earlier:"],
    [],
    ["Order", "Sheet", "What it is"],
  ];
  schemas.forEach((schema, i) => {
    intro.push([String(i + 1), schema.label, schema.description]);
  });
  intro.push([]);
  intro.push(["Upload each sheet on Import & Export, one at a time, picking the"]);
  intro.push(["matching list before you upload."]);
  addSheet(book, "Start here", intro);

  for (const schema of schemas) {
    addSheet(book, schema.label, exampleGrid(schema, examplesFor(schema)));
  }
  return XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

/** Hand the browser a workbook. */
export function downloadWorkbook(filename: string, bytes: ArrayBuffer) {
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Hand the browser a file. Kept here so every caller behaves the same. */
export function download(filename: string, content: string, type = "text/csv;charset=utf-8") {
  // The BOM makes Excel open UTF-8 CSVs without mangling accented names.
  const blob = new Blob([type.startsWith("text/csv") ? "﻿" + content : content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function stamp(name: string, ext = "csv") {
  return `${name}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}
