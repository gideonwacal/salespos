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
  | "drugshop"
  | "clinic"
  | "medical_centre"
  | "hospital"
  | "hardware"
  | "restaurant"
  | "electronics"
  | "general";

/**
 * The trade a profile belongs to.
 *
 * Health is not one business. A drug shop sells packets across a counter, a
 * hospital runs a store behind a ward, and a clinic does both while charging
 * for the consultation as well. They share drug classes, expiry dates and
 * batch numbers, which is why they are one family of profiles rather than one
 * profile — and why the picker groups them instead of listing eleven trades
 * flat.
 */
export type IndustryFamily = "retail" | "health" | "trade" | "food";

export const FAMILY_LABELS: Record<IndustryFamily, string> = {
  retail: "Shops & general trade",
  health: "Health",
  trade: "Building & technical",
  food: "Food & drink",
};

/** Optional product columns a profile can switch on. */
export type ProductFeature =
  | "wholesale_price"
  | "bulk_pricing"
  | "bottle_deposit"
  | "expiry"
  | "batch_number"
  | "prescription"
  | "barcode"
  | "unit_of_measure"
  /** Things sold that were never on a shelf: a consultation, a lab test, a bed-night. */
  | "service_item";

export type IndustryProfile = {
  id: IndustryId;
  family: IndustryFamily;
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
  /** Categories whose items are services rather than stock, seeded at setup. */
  serviceCategories?: string[];
};

const PROFILES: IndustryProfile[] = [
  {
    id: "wholesale",
    family: "retail",
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
    family: "retail",
    label: "Supermarket / Grocery",
    blurb: "Barcode checkout, departments and fresh-stock expiry.",
    terms: {
      products: "Products",
      product: "product",
      inventory: "Stock list",
      category: "Department",
    },
    features: ["barcode", "expiry", "unit_of_measure", "bulk_pricing"],
    categories: [
      "Fresh Produce",
      "Bakery",
      "Dairy & Chilled",
      "Frozen Foods",
      "Butchery",
      "Deli & Cooked Food",
      "Dry Goods",
      "Beverages",
      "Wines & Spirits",
      "Confectionery & Snacks",
      "Household & Cleaning",
      "Personal Care",
      "Baby Products",
      "Stationery",
      "Pet Supplies",
    ],
    defaults: { low_stock_alerts: true, expiry_alerts: true },
    units: ["piece", "kg", "g", "litre", "ml", "pack", "dozen", "crate", "tray"],
  },
  {
    id: "pharmacy",
    family: "health",
    label: "Pharmacy",
    blurb: "Batch numbers, expiry control and prescription-only dispensing.",
    terms: {
      products: "Medicines",
      product: "medicine",
      inventory: "Dispensary",
      category: "Drug class",
    },
    features: ["expiry", "batch_number", "prescription", "barcode", "unit_of_measure"],
    categories: [
      "Antibiotics",
      "Analgesics & Painkillers",
      "Antimalarials",
      "Anti-inflammatory",
      "Cough & Cold",
      "Cardiovascular",
      "Diabetes Care",
      "Vitamins & Supplements",
      "First Aid & Dressings",
      "Baby & Maternal",
      "Medical Devices",
      "Over-the-counter",
    ],
    // Expired stock is a patient-safety matter, never just a cost.
    defaults: { low_stock_alerts: true, expiry_alerts: true },
    units: ["tablet", "capsule", "bottle", "sachet", "tube", "vial", "ampoule", "pack"],
  },
  {
    id: "drugshop",
    family: "health",
    label: "Drug shop",
    blurb: "Over-the-counter medicines, expiry watch, no prescription register.",
    terms: {
      products: "Medicines",
      product: "medicine",
      inventory: "Drug shelf",
      category: "Drug class",
    },
    // A licensed drug shop may not dispense prescription-only medicines, so the
    // field is left off rather than left empty — there is nothing to record.
    features: ["expiry", "batch_number", "unit_of_measure"],
    categories: [
      "Analgesics & Painkillers",
      "Antimalarials",
      "Cough & Cold",
      "Deworming",
      "Oral Rehydration",
      "Vitamins & Supplements",
      "First Aid & Dressings",
      "Baby & Maternal",
      "Family Planning",
      "Over-the-counter",
    ],
    defaults: { low_stock_alerts: true, expiry_alerts: true },
    units: ["tablet", "capsule", "bottle", "sachet", "tube", "pack"],
  },
  {
    id: "clinic",
    family: "health",
    label: "Clinic",
    blurb: "Charge the consultation as well as the medicine dispensed.",
    terms: {
      products: "Medicines & services",
      product: "item",
      inventory: "Dispensary",
      category: "Drug class",
    },
    // A consultation has no shelf and never runs out; service_item is what
    // stops the counter refusing to sell one because stock reads zero.
    features: ["expiry", "batch_number", "prescription", "unit_of_measure", "service_item"],
    categories: [
      "Consultation & Services",
      "Injectables",
      "Antibiotics",
      "Analgesics & Painkillers",
      "Antimalarials",
      "Cough & Cold",
      "IV Fluids",
      "Dressings & Sutures",
      "Family Planning",
      "Vitamins & Supplements",
      "Medical Sundries",
    ],
    defaults: { low_stock_alerts: true, expiry_alerts: true },
    units: ["tablet", "capsule", "bottle", "vial", "ampoule", "sachet", "visit", "session"],
    serviceCategories: ["Consultation & Services"],
  },
  {
    id: "medical_centre",
    family: "health",
    label: "Medical centre",
    blurb: "Consultations, laboratory tests and a dispensary under one roof.",
    terms: {
      products: "Medicines & services",
      product: "item",
      inventory: "Dispensary & store",
      category: "Drug class",
    },
    features: ["expiry", "batch_number", "prescription", "unit_of_measure", "service_item"],
    categories: [
      "Consultation & Services",
      "Laboratory Tests",
      "Imaging & Scans",
      "Minor Procedures",
      "Injectables",
      "Antibiotics",
      "Antimalarials",
      "IV Fluids",
      "Dressings & Sutures",
      "Maternal & Child Health",
      "Vitamins & Supplements",
      "Medical Sundries",
    ],
    defaults: { low_stock_alerts: true, expiry_alerts: true },
    units: ["tablet", "capsule", "bottle", "vial", "ampoule", "test", "visit", "session"],
    serviceCategories: [
      "Consultation & Services",
      "Laboratory Tests",
      "Imaging & Scans",
      "Minor Procedures",
    ],
  },
  {
    id: "hospital",
    family: "health",
    label: "Hospital",
    blurb: "A store behind the wards: drugs, sundries, theatre and bed charges.",
    terms: {
      products: "Medicines & supplies",
      product: "item",
      inventory: "Hospital store",
      category: "Store section",
    },
    features: ["expiry", "batch_number", "prescription", "unit_of_measure", "service_item"],
    categories: [
      "Consultation & Services",
      "Ward & Bed Charges",
      "Theatre & Surgery",
      "Laboratory Tests",
      "Imaging & Scans",
      "Injectables",
      "Antibiotics",
      "Anaesthetics",
      "IV Fluids",
      "Dressings & Sutures",
      "Surgical Sundries",
      "Maternity",
      "Oxygen & Gases",
      "Medical Equipment",
    ],
    defaults: { low_stock_alerts: true, expiry_alerts: true },
    units: ["tablet", "capsule", "bottle", "vial", "ampoule", "unit", "test", "night", "session"],
    serviceCategories: [
      "Consultation & Services",
      "Ward & Bed Charges",
      "Theatre & Surgery",
      "Laboratory Tests",
      "Imaging & Scans",
    ],
  },
  {
    id: "hardware",
    family: "trade",
    label: "Hardware & Building",
    blurb: "Trade vs retail pricing and goods sold by measure.",
    terms: {
      products: "Items",
      product: "item",
      inventory: "Stock",
      category: "Section",
    },
    features: ["wholesale_price", "bulk_pricing", "unit_of_measure", "service_item"],
    categories: [
      "Cement & Aggregates",
      "Timber",
      "Steel & Reinforcement",
      "Roofing",
      "Doors & Windows",
      "Plumbing",
      "Electrical",
      "Paint & Finishes",
      "Adhesives & Sealants",
      "Tools & Equipment",
      "Fixings & Fasteners",
      "Safety Gear",
      "Delivery & Hire",
    ],
    // Cement and steel do not expire; the alert would only ever be noise.
    defaults: { low_stock_alerts: true, expiry_alerts: false },
    units: [
      "piece",
      "bag",
      "metre",
      "foot",
      "kg",
      "tonne",
      "litre",
      "roll",
      "sheet",
      "bundle",
      "pair",
      "trip",
    ],
    // Delivery and plant hire are charged like goods but were never in stock.
    serviceCategories: ["Delivery & Hire"],
  },
  {
    id: "restaurant",
    family: "food",
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
    family: "trade",
    label: "Electronics",
    blurb: "Serial-tracked goods with trade pricing.",
    terms: {
      products: "Products",
      product: "product",
      inventory: "Inventory",
      category: "Category",
    },
    features: ["wholesale_price", "barcode", "service_item"],
    categories: [
      "Phones & Tablets",
      "Computers",
      "Accessories",
      "Audio & TV",
      "Cables & Chargers",
      "Batteries & Power",
      "Spare Parts",
      "Repairs & Servicing",
    ],
    defaults: { low_stock_alerts: true, expiry_alerts: false },
    // A screen replacement is labour, not a part on the shelf.
    serviceCategories: ["Repairs & Servicing"],
  },
  {
    id: "general",
    family: "retail",
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

export type IndustryGroup = {
  family: IndustryFamily;
  label: string;
  profiles: IndustryProfile[];
};

/** The profiles grouped for a picker, in the order the groups should appear. */
export const INDUSTRY_GROUPS: IndustryGroup[] = (
  ["retail", "health", "trade", "food"] as IndustryFamily[]
).map((family) => ({
  family,
  label: FAMILY_LABELS[family],
  profiles: PROFILES.filter((p) => p.family === family),
}));

const BY_ID = new Map(PROFILES.map((p) => [p.id, p]));

/** Older workspaces stored the label, not the id, so match on both. */
export function resolveIndustry(value: string | null | undefined): IndustryProfile {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return BY_ID.get("wholesale")!;

  const byId = BY_ID.get(raw as IndustryId);
  if (byId) return byId;

  const byLabel = PROFILES.find((p) => p.label.toLowerCase() === raw);
  if (byLabel) return byLabel;

  // Legacy labels from the first version of the setup wizard, plus the
  // spellings people type for the health trades.
  const legacy: Record<string, IndustryId> = {
    "wholesale & retail": "wholesale",
    "supermarket / grocery": "supermarket",
    "beverages & drinks": "wholesale",
    pharmacy: "pharmacy",
    chemist: "pharmacy",
    "drug shop": "drugshop",
    "drug store": "drugshop",
    drugstore: "drugshop",
    "medical centre": "medical_centre",
    "medical center": "medical_centre",
    "health centre": "medical_centre",
    "health center": "medical_centre",
    clinic: "clinic",
    hospital: "hospital",
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

/** True for the trades that dispense medicine, whatever their size. */
export function isHealth(profile: IndustryProfile) {
  return profile.family === "health";
}

/**
 * Is a category one this trade charges for without stocking?
 *
 * Used to default the "service" switch when an item is created, so a clinic
 * adding "Consultation" under Consultation & Services does not have to know
 * the switch exists.
 */
export function isServiceCategory(profile: IndustryProfile, category: string) {
  return (profile.serviceCategories ?? []).includes(category);
}
