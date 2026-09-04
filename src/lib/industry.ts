/**
 * Industry profiles.
 *
 * One codebase, reshaped per business type. A profile decides what a product is
 * called, which of its fields are worth showing, and what categories the shop
 * starts with — so a pharmacy never sees bottle deposits and a hardware store is
 * never asked for an expiry date.
 *
 * The profile is chosen at sign-up and stored on the workspace, so it follows
 * the business rather than the device. `resolveIndustry` falls back to wholesale
 * for older workspaces that predate the picker.
 */

export type IndustryId =
  | "wholesale"
  | "supermarket"
  | "pharmacy"
  | "hardware"
  | "restaurant"
  | "electronics"
  | "general";

/** Optional product columns a profile can switch on. */
export type ProductFeature =
  | "wholesale_price"
  | "bulk_pricing"
  | "bottle_deposit"
  | "expiry"
  | "batch_number"
  | "prescription"
  | "barcode"
  | "unit_of_measure";

export type IndustryProfile = {
  id: IndustryId;
  /** What the setup wizard and sign-up form show. */
  label: string;
  blurb: string;
  terms: {
    /** Plural, title case: "Products", "Medicines", "Items". */
    products: string;
    /** Singular, lower case: "product", "medicine", "item". */
    product: string;
    /** The inventory nav entry and page heading. */
    inventory: string;
    /** What a category is called: "Category", "Department", "Section". */
    category: string;
  };
  features: ProductFeature[];
  categories: string[];
  /** Sensible workspace defaults for this trade. */
  defaults: {
    low_stock_alerts: boolean;
    expiry_alerts: boolean;
  };
  /** Units offered when the profile uses unit_of_measure. */
  units?: string[];
};

const PROFILES: IndustryProfile[] = [
  {
    id: "wholesale",
    label: "Wholesale & Retail",
    blurb: "Tiered pricing, bulk discounts and bottle deposits.",
    terms: {
      products: "Products",
      product: "product",
      inventory: "Inventory",
      category: "Category",
    },
    features: ["wholesale_price", "bulk_pricing", "bottle_deposit", "expiry"],
    categories: [
      "General Merchandise",
      "Beverages",
      "Soft Drinks",
      "Foodstuff & Grains",
      "Toiletries",
      "Household",
      "Airtime & Data",
    ],
    defaults: { low_stock_alerts: true, expiry_alerts: true },
  },
  {
    id: "supermarket",
    label: "Supermarket / Grocery",
    blurb: "Barcode checkout, departments and fresh-stock expiry.",
    terms: {
      products: "Products",
      product: "product",
      inventory: "Stock list",
      category: "Department",
    },
    features: ["barcode", "expiry", "unit_of_measure"],
    categories: [
      "Fresh Produce",
      "Bakery",
      "Dairy & Chilled",
      "Frozen Foods",
      "Butchery",
      "Dry Goods",
      "Beverages",
      "Household & Cleaning",
      "Personal Care",
      "Baby Products",
    ],
    defaults: { low_stock_alerts: true, expiry_alerts: true },
    units: ["piece", "kg", "g", "litre", "ml", "pack", "dozen"],
  },
  {
    id: "pharmacy",
    label: "Pharmacy",
    blurb: "Batch numbers, expiry control and prescription-only tracking.",
    terms: {
      products: "Medicines",
      product: "medicine",
      inventory: "Dispensary",
      category: "Drug class",
    },
    features: ["expiry", "batch_number", "prescription", "barcode"],
    categories: [
      "Antibiotics",
      "Analgesics & Painkillers",
      "Antimalarials",
      "Anti-inflammatory",
      "Cough & Cold",
      "Vitamins & Supplements",
      "First Aid & Dressings",
      "Baby & Maternal",
      "Medical Devices",
      "Over-the-counter",
    ],
    // Expired stock is a patient-safety matter, never just a cost.
    defaults: { low_stock_alerts: true, expiry_alerts: true },
    units: ["tablet", "capsule", "bottle", "sachet", "tube", "vial", "pack"],
  },
  {
    id: "hardware",
    label: "Hardware & Building",
    blurb: "Trade vs retail pricing and goods sold by measure.",
    terms: {
      products: "Items",
      product: "item",
      inventory: "Stock",
      category: "Section",
    },
    features: ["wholesale_price", "bulk_pricing", "unit_of_measure"],
    categories: [
      "Cement & Aggregates",
      "Timber",
      "Steel & Reinforcement",
      "Roofing",
      "Plumbing",
      "Electrical",
      "Paint & Finishes",
      "Tools & Equipment",
      "Fixings & Fasteners",
    ],
    // Cement and steel do not expire; the alert would only ever be noise.
    defaults: { low_stock_alerts: true, expiry_alerts: false },
    units: ["piece", "bag", "metre", "foot", "kg", "tonne", "litre", "roll", "sheet"],
  },
  {
    id: "restaurant",
    label: "Restaurant / Bar",
    blurb: "Menu items, bottle deposits and kitchen stock.",
    terms: {
      products: "Menu & stock",
      product: "item",
      inventory: "Menu & stock",
      category: "Menu section",
    },
    features: ["bottle_deposit", "expiry", "unit_of_measure"],
    categories: [
      "Starters",
      "Main Dishes",
      "Grill & Roast",
      "Sides",
      "Desserts",
      "Soft Drinks",
      "Beers & Ciders",
      "Wines & Spirits",
      "Hot Beverages",
      "Kitchen Stock",
    ],
    defaults: { low_stock_alerts: true, expiry_alerts: true },
    units: ["plate", "piece", "bottle", "glass", "jug", "kg", "litre"],
  },
  {
    id: "electronics",
    label: "Electronics",
    blurb: "Serial-tracked goods with trade pricing.",
    terms: {
      products: "Products",
      product: "product",
      inventory: "Inventory",
      category: "Category",
    },
    features: ["wholesale_price", "barcode"],
    categories: [
      "Phones & Tablets",
      "Computers",
      "Accessories",
      "Audio & TV",
      "Cables & Chargers",
      "Batteries & Power",
      "Spare Parts",
    ],
    defaults: { low_stock_alerts: true, expiry_alerts: false },
  },
  {
    id: "general",
    label: "Other / General trade",
    blurb: "A neutral setup you can shape yourself.",
    terms: {
      products: "Products",
      product: "product",
      inventory: "Inventory",
      category: "Category",
    },
    features: ["wholesale_price", "expiry"],
    categories: ["General Merchandise", "Services", "Miscellaneous"],
    defaults: { low_stock_alerts: true, expiry_alerts: true },
  },
];

export const INDUSTRY_PROFILES = PROFILES;

const BY_ID = new Map(PROFILES.map((p) => [p.id, p]));

/** Older workspaces stored the label, not the id, so match on both. */
export function resolveIndustry(value: string | null | undefined): IndustryProfile {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return BY_ID.get("wholesale")!;

  const byId = BY_ID.get(raw as IndustryId);
  if (byId) return byId;

  const byLabel = PROFILES.find((p) => p.label.toLowerCase() === raw);
  if (byLabel) return byLabel;

  // Legacy labels from the first version of the setup wizard.
  const legacy: Record<string, IndustryId> = {
    "wholesale & retail": "wholesale",
    "supermarket / grocery": "supermarket",
    "beverages & drinks": "wholesale",
    pharmacy: "pharmacy",
    hardware: "hardware",
    electronics: "electronics",
    "restaurant / bar": "restaurant",
    other: "general",
  };
  return BY_ID.get(legacy[raw] ?? "wholesale")!;
}

/** Does this profile show the given product field? */
export function hasFeature(profile: IndustryProfile, feature: ProductFeature) {
  return profile.features.includes(feature);
}
