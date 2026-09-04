# Pamoja Connect

Build a real-time, multi-user POS, Inventory, and Financial Management System for "Pamoja Traders" — a wholesale & retail general merchandise business located at Orupe Road, Ocaapa Town Council, Serere District.

### 🌐 TWO-WAY / DUAL-ROLE ARCHITECTURE

The system must support a remote management workflow between two primary locations:

1. **Kampala HQ (Owner/Admin Dashboard):**

   - Live multi-device tracking of all daily sales, profits, stock movements, and expenses happening in Serere.

   - Master controls: Set/edit buying & selling prices, approve expense reports, view overall P&L, manage user permissions, and adjust stock threshold alerts.

2. **Serere Branch (Manager/Cashier Terminal):**

   - Optimized for fast day-to-day operations: Recording POS sales (wholesale & retail), logging stock arrivals, and entering daily shop expenses (power, transport, handling, rent, wages).

   - Restricted view: Simple POS interface with low latency, optional offline support/sync, and daily reconciliation features.

---

### 1. CORE MODULES & FEATURES

#### A. Header & Executive Summary Dashboard (Kampala View)

- Business Branding: **Pamoja Traders** (*Orupe Road, Ocaapa Town Council, Serere District*).

- **Live Performance Metrics:**

  - Today's Sales Total & Net Profit (UGX)

  - Real-Time Total Stock Valuation (Total Cost vs Projected Revenue)

  - Month-to-Date Operating Overhead Expenses

  - Low Stock & Reorder Alerts

  - Live Feed: Recent Transactions logged by Serere staff.

#### B. Inventory & Stock Management (Excel-Based Data Structure)

- Master Inventory Grid:

  - `Item Name`

  - `Category` (Soft Drinks, Alcoholic Drinks, Household Items, General Merchandise)

  - `Stock Quantity` (In-Stock Level)

  - `Unit Buying Price`

  - `Unit Selling Price`

  - `Profit Margin` (`Selling Price - Buying Price`)

  - `Total Stock Cost` (`Quantity * Buying Price`)

  - `Projected Profit` (`Quantity * Profit Margin`)

  - `Reorder Threshold`

- Features: Add/Edit Products, Batch Import/Export CSV, Stock Count Adjustments (Stock-In, Stock-Out, Loss/Damage logs with mandatory audit reasons).

#### C. Point of Sale (POS) & Billing (Serere Terminal)

- Fast search/barcode picker for quick checkout.

- **Wholesale vs Retail Pricing Toggle:** Ability to dynamically switch unit prices depending on buyer type.

- Cart with live total calculation and multiple payment options: Cash, Mobile Money (MTN/Airtel), Bank Transfer, or Credit/Tab.

- Thermal Receipt Generation (Printable / PDF) with business header details.

#### D. Overhead & Operating Expense Tracker

- Dedicated Expense Logging Module to capture local shop costs:

  - **Categories:** Power/Electricity, Transport & Freight, Offloading/Handling, Shop Rent, Staff Wages, Local Taxes, Miscellaneous.

  - **Fields:** Date, Category, Amount (UGX), Payment Method, Vendor/Paid To, Notes/Receipt photo log, Logged By.

  - Category breakdown chart comparing operational overhead vs gross profit.

#### E. Sales, Shift & Reconciliation Reports

- End-of-Day Shift Closure report for Serere staff to balance daily cash/mobile money against logged sales.

- **Profitability & P&L Statement (Kampala HQ):**

  - Gross Revenue - Cost of Goods Sold (COGS) = Gross Margin

  - Gross Margin - Overhead Costs (Power, Transport, Wages, Rent) = Net Operating Profit.

---

### 2. ROLE-BASED ACCESS CONTROL (RBAC) & PERMISSIONS

1. **Owner / Admin (Kampala):** Full CRUD permissions across all products, prices, financial reports, user management, expense approvals, and audit logs.

2. **Shop Manager / Staff (Serere):** Can process sales, view inventory levels, record new stock arrivals, and submit daily overhead expenses. Cannot alter buying prices or delete historical transactions without approval.

---

### 3. DATABASE SCHEMA (SUPABASE / POSTGRESQL)

1. `profiles`: `id`, `full_name`, `role` ('owner_kampala', 'manager_serere'), `phone`, `created_at`

2. `products`: `id`, `name`, `category`, `unit_buying_price`, `unit_selling_price`, `stock_quantity`, `reorder_level`, `created_at`

3. `stock_transactions`: `id`, `product_id`, `type` ('stock_in', 'sale', 'adjustment', 'damage'), `quantity`, `notes`, `performed_by`, `created_at`

4. `sales`: `id`, `sale_type` ('wholesale', 'retail'), `total_amount`, `payment_method`, `customer_name`, `cashier_id`, `created_at`

5. `sale_items`: `id`, `sale_id`, `product_id`, `quantity`, `unit_price`, `unit_cost`, `subtotal`

6. `expenses`: `id`, `category`, `amount`, `description`, `expense_date`, `logged_by`, `payment_method`, `created_at`

---

### 4. DESIGN & UX GUIDELINES

- **Theme:** Clean, modern enterprise UI built with Tailwind CSS and Shadcn UI.

- **Palette:** Slate Blue `#1e293b` header, Emerald Green `#10b981` for sales/profits, Amber `#f59e0b` for low stock alerts.

- **Currency Formatting:** Display numbers in clean Ugandan Shilling format (e.g., `UGX 1,302,000`).

- **Responsive Navigation:** Top navigation bar with quick role-switcher preview, search bar, and clean sidebar tabs for Dashboard, Inventory, POS Terminal, Expenses, and Financial Reports.

---

Please populate the initial state with pre-filled sample items from Pamoja Traders (drinks like Bebwine, Lavida, Teju, Jaja, Kituzi, Kabisa, soft drinks, and household goods) alongside sample daily expenses so both the Kampala Owner View and Serere Staff View are immediately testable!

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
