/**
 * What can be imported and exported, category by category.
 *
 * Each schema is the whole definition of a dataset: the columns, the spellings
 * people are likely to have in their own spreadsheets, and the row-level rules.
 * The import dialog is generic, so a new category is a new entry here.
 *
 * Product columns depend on the trade, which is why `datasetsFor` takes an
 * industry profile — a pharmacy imports batch numbers, hardware imports units.
 */

import type { TransferSchema } from "@/lib/transfer";
import { hasFeature, type IndustryProfile } from "@/lib/industry";

const CUSTOMERS: TransferSchema = {
  id: "customers",
  label: "Customers",
  table: "customers",
  description: "Credit customers and the people whose empties you track.",
  columns: [
    // Exported so it can be pasted into a debts sheet; ignored on import,
    // where the server assigns the id.
    { key: "id", label: "Customer ID", kind: "text", example: "" },
    {
      key: "name",
      label: "Name",
      kind: "text",
      required: true,
      aliases: ["customer", "customer name", "client", "shop name"],
      example: "Nakawa Retail Shop",
    },
    {
      key: "phone",
      label: "Phone",
      kind: "text",
      aliases: ["telephone", "tel", "mobile", "contact"],
      example: "0772-334455",
    },
    { key: "notes", label: "Notes", kind: "text", aliases: ["note", "remarks"], example: "Weekly buyer" },
  ],
};

const STAFF: TransferSchema = {
  id: "staff",
  label: "Staff",
  table: "users",
  description:
    "People who work the counter. Each row becomes a real login they can sign in with.",
  columns: [
    {
      key: "full_name",
      label: "Full name",
      kind: "text",
      required: true,
      aliases: ["name", "staff name", "employee", "employee name"],
      example: "Grace Nakato",
    },
    {
      key: "email",
      label: "Email",
      kind: "text",
      required: true,
      aliases: ["email address", "e-mail", "username", "login"],
      example: "grace@yourshop.ug",
    },
    { key: "phone", label: "Phone", kind: "text", aliases: ["telephone", "mobile"], example: "0772-445566" },
    {
      key: "role",
      label: "Role",
      kind: "text",
      fallback: "manager",
      aliases: ["position", "access", "level"],
      example: "manager",
    },
    {
      key: "password",
      label: "Temporary password",
      kind: "text",
      required: true,
      aliases: ["password", "temp password", "pin"],
      example: "Counter2026!",
    },
  ],
  validateRow(row) {
    const email = String(row.email ?? "");
    if (!email.includes("@")) return `"${email}" is not an email address`;

    const role = String(row.role ?? "").toLowerCase().trim();
    // Spreadsheets carry job titles; map the common ones onto the two roles.
    const owners = ["owner", "admin", "administrator", "manager/owner", "director"];
    row.role = owners.includes(role) ? "owner" : "manager";

    // Django rejects anything shorter, and a bounced row is worse than a clear
    // message before we start.
    if (String(row.password ?? "").length < 8) {
      return "Temporary password must be at least 8 characters";
    }
    return null;
  },
};

const EXPENSES: TransferSchema = {
  id: "expenses",
  label: "Expenses",
  table: "expenses",
  description: "Rent, wages, transport and other money going out.",
  columns: [
    {
      key: "description",
      label: "Description",
      kind: "text",
      required: true,
      aliases: ["details", "particulars", "item", "expense"],
      example: "Delivery van fuel",
    },
    {
      key: "amount",
      label: "Amount",
      kind: "money",
      required: true,
      aliases: ["value", "cost", "total", "amount ugx"],
      example: "120000",
    },
    {
      key: "category",
      label: "Category",
      kind: "text",
      fallback: "Other",
      aliases: ["type", "expense category"],
      example: "Transport & Freight",
    },
    {
      key: "expense_date",
      label: "Date",
      kind: "date",
      aliases: ["date", "spent on", "expense date"],
      example: "2026-09-01",
    },
    {
      key: "vendor",
      label: "Paid to",
      kind: "text",
      aliases: ["vendor", "supplier", "payee", "paid to"],
      example: "Shell Kampala",
    },
    {
      key: "payment_method",
      label: "Paid by",
      kind: "text",
      fallback: "cash",
      aliases: ["payment", "method", "payment method", "paid by"],
      example: "cash",
    },
  ],
};

const SUPPLIERS: TransferSchema = {
  id: "suppliers",
  label: "Suppliers",
  table: "suppliers",
  description: "Who you buy from and what you still owe them.",
  columns: [
    {
      key: "name",
      label: "Name",
      kind: "text",
      required: true,
      aliases: ["supplier", "supplier name", "vendor"],
      example: "Century Bottling",
    },
    { key: "contact", label: "Contact", kind: "text", aliases: ["phone", "telephone"], example: "0700-999888" },
    { key: "email", label: "Email", kind: "text", aliases: ["email address"], example: "sales@century.ug" },
    { key: "address", label: "Address", kind: "text", aliases: ["location"], example: "Namanve" },
    { key: "balance", label: "Balance owed", kind: "money", aliases: ["owed", "due", "outstanding"], example: "1200000" },
  ],
};

const DEBTS: TransferSchema = {
  id: "debts",
  label: "Credit / debtors",
  table: "debts",
  description:
    "Opening balances for customers who already owe you. Import customers first.",
  columns: [
    {
      key: "customer_id",
      label: "Customer ID",
      kind: "text",
      required: true,
      aliases: ["customer", "customer id"],
      example: "paste from the Customers export",
    },
    {
      key: "total_value",
      label: "Amount owed",
      kind: "money",
      required: true,
      aliases: ["amount", "total", "value", "debt"],
      example: "850000",
    },
    {
      key: "items_summary",
      label: "For",
      kind: "text",
      fallback: "Opening balance",
      aliases: ["items", "description", "details"],
      example: "20 crates soda",
    },
    { key: "issue_date", label: "Issued", kind: "date", aliases: ["date", "issue date"], example: "2026-09-01" },
    { key: "due_date", label: "Due", kind: "date", required: true, aliases: ["due", "due date"], example: "2026-09-30" },
  ],
};

/** Sales are exported for the books; they are made at the counter, not imported. */
const SALES: TransferSchema = {
  id: "sales",
  label: "Sales",
  table: "sales",
  description: "Every completed sale, for your accountant or your own records.",
  columns: [
    { key: "created_at", label: "Date", kind: "text" },
    { key: "sale_type", label: "Type", kind: "text" },
    { key: "customer_name", label: "Customer", kind: "text" },
    { key: "payment_method", label: "Payment", kind: "text" },
    { key: "total_amount", label: "Total", kind: "money" },
    { key: "total_cost", label: "Cost", kind: "money" },
    { key: "profit", label: "Profit", kind: "money" },
  ],
};

function products(industry: IndustryProfile): TransferSchema {
  const columns: TransferSchema["columns"] = [
    {
      key: "name",
      label: "Name",
      kind: "text",
      required: true,
      aliases: ["item", "product", "product name", "description", "medicine"],
      example: "Sugar 1kg",
    },
    {
      key: "category",
      label: industry.terms.category,
      kind: "text",
      fallback: industry.categories[0],
      aliases: ["category", "department", "section", "drug class", "type", "group"],
      example: industry.categories[0],
    },
    {
      key: "unit_buying_price",
      label: "Buying price",
      kind: "money",
      aliases: ["cost", "cost price", "buy price", "purchase price"],
      example: "4200",
    },
    {
      key: "unit_selling_price",
      label: "Selling price",
      kind: "money",
      aliases: ["price", "retail price", "sell price", "selling"],
      example: "5000",
    },
    {
      key: "stock_quantity",
      label: "Quantity",
      kind: "integer",
      aliases: ["qty", "stock", "quantity in stock", "on hand", "balance"],
      example: "120",
    },
    {
      key: "reorder_level",
      label: "Reorder level",
      kind: "integer",
      fallback: 10,
      aliases: ["reorder", "minimum", "min stock", "alert level"],
      example: "20",
    },
  ];

  if (hasFeature(industry, "wholesale_price")) {
    columns.push({
      key: "wholesale_price",
      label: industry.id === "hardware" ? "Trade price" : "Wholesale price",
      kind: "money",
      // Absent means "no trade price", not "free".
      fallback: null,
      aliases: ["wholesale", "trade price", "bulk price"],
      example: "4600",
    });
  }
  if (hasFeature(industry, "unit_of_measure")) {
    columns.push({
      key: "unit_of_measure",
      label: "Sold by",
      kind: "text",
      fallback: industry.units?.[0] ?? "piece",
      aliases: ["unit", "uom", "measure", "sold by"],
      example: industry.units?.[0] ?? "piece",
    });
  }
  if (hasFeature(industry, "barcode")) {
    columns.push({
      key: "barcode",
      label: "Barcode",
      kind: "text",
      aliases: ["ean", "upc", "sku", "code"],
      example: "6001234567890",
    });
  }
  if (hasFeature(industry, "batch_number")) {
    columns.push({
      key: "batch_number",
      label: "Batch number",
      kind: "text",
      aliases: ["batch", "lot", "lot number"],
      example: "B-2291",
    });
  }
  if (hasFeature(industry, "expiry")) {
    columns.push({
      key: "expiry_date",
      label: "Expiry date",
      kind: "date",
      aliases: ["expiry", "expires", "best before", "exp date"],
      example: "2027-03-31",
    });
  }
  if (hasFeature(industry, "prescription")) {
    columns.push({
      key: "prescription_only",
      label: "Prescription only",
      kind: "boolean",
      aliases: ["pom", "prescription", "rx"],
      example: "yes",
    });
  }

  return {
    id: "products",
    label: industry.terms.products,
    table: "products",
    description: `Your ${industry.terms.products.toLowerCase()} — prices, stock levels and reorder points.`,
    columns,
    validateRow(row) {
      const buy = Number(row.unit_buying_price ?? 0);
      const sell = Number(row.unit_selling_price ?? 0);
      // Not fatal, but almost always a column swapped in the sheet.
      if (sell > 0 && buy > 0 && sell < buy) {
        return `Selling price (${sell}) is below the buying price (${buy}) — check the columns`;
      }
      return null;
    },
  };
}

/** Everything this business can move in and out, in menu order. */
export function datasetsFor(industry: IndustryProfile): TransferSchema[] {
  return [products(industry), STAFF, CUSTOMERS, DEBTS, SUPPLIERS, EXPENSES, SALES];
}

/** Datasets that only make sense to export. */
export const EXPORT_ONLY = new Set(["sales"]);
