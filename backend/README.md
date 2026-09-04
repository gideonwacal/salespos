# SalesPos backend

Django + DRF + Postgres. Replaces the localStorage engine in `src/lib/demo.ts`
and the unused Supabase schema in `supabase/`.

## Running it

```sh
cd backend
py -m venv .venv
.venv/Scripts/activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env            # then set DJANGO_SECRET_KEY and DATABASE_URL
createdb pamojahub              # or create the database however you normally do

python manage.py migrate
python manage.py seed_demo      # optional: 24 sample products + 8 expenses
python manage.py runserver
```

The API is then on `http://localhost:8000/api/`. Point the frontend at it with
`VITE_API_URL=http://localhost:8000/api` in the root `.env`; that is already the
default, so usually you don't need to set anything.

## How it's laid out

| Path | What's in it |
| --- | --- |
| `config/` | settings, root urls, wsgi/asgi |
| `apps/core/` | abstract model bases, tenancy, permissions, pagination, `seed_demo` |
| `apps/accounts/` | `User`, `Workspace`, `Membership`, JWT auth endpoints |
| `apps/inventory/` | `Product`, `StockTransaction`, `DamageReport` + stock services |
| `apps/sales/` | `Sale`, `SaleItem` + the checkout service |
| `apps/expenses/` | `Expense` + approval flow |

## Multi-tenancy

`Workspace` is the tenant. Every business table inherits `WorkspaceScoped`, so it
cannot exist without a workspace FK.

The client sends `X-Workspace: <uuid>`. `resolve_workspace()` only honours it
after confirming the authenticated user has an active `Membership` in that
workspace — a forged header gets a 403, not someone else's data. With no header
we fall back to the user's first membership.

`WorkspaceViewSet` filters every queryset and stamps every create, so a new
endpoint is tenant-safe by inheriting from it rather than by remembering to add
a filter.

## Where the Supabase logic went

RLS policies and Postgres triggers are now Python:

| Was | Is now |
| --- | --- |
| `apply_stock_transaction()` trigger | `apps/inventory/services.record_stock_transaction` |
| `apply_damage_report()` trigger | `apps/inventory/services.record_damage` |
| `sync_product_expiry()` trigger | folded into `record_stock_transaction` |
| `apply_sale_item()` trigger | `apps/sales/services.create_sale` |
| `is_owner()` + `owner deletes ...` policies | `apps/core/permissions.OwnerOnlyDelete` |
| `owner updates expenses` policy | `ExpenseSerializer.validate` + `approve`/`reject` actions |
| "readable by authenticated" policies | queryset scoping in `WorkspaceViewSet` |

Two things the triggers didn't do, which the services now do:

- **Checkout is one transaction.** A basket where line 3 is out of stock rolls
  back lines 1 and 2 as well. Previously each `sale_items` insert fired its own
  trigger, so a partial basket could commit.
- **Products are locked during checkout.** `select_for_update()` means two
  concurrent sales of the same product can't both read the same starting
  quantity and lose one of the decrements.

## Endpoints

```
POST   /api/auth/register/          new user + workspace, returns tokens
POST   /api/auth/login/             email + password -> access/refresh
POST   /api/auth/refresh/           refresh -> new access
GET    /api/auth/me/                user, workspaces, active workspace, role

GET    /api/workspaces/             business profiles you belong to
PATCH  /api/workspaces/<id>/        edit settings (owner only)

GET    /api/members/                staff roster for the active workspace
POST   /api/members/                add a teammate (owner only)

GET    /api/products/               ?search= &category= &ordering=
GET    /api/products/low_stock/     at or below reorder level
POST   /api/stock-transactions/     stock in / adjustment / damage
POST   /api/damage-reports/         write-off + audit trail

GET    /api/sales/                  with nested line items
POST   /api/sales/                  checkout: {items:[{product_id,quantity}], ...}
GET    /api/sales/summary/          today + all-time revenue, cost, profit
DELETE /api/sales/<id>/             void, returning stock (owner only)

GET    /api/expenses/               ?status= &category=
POST   /api/expenses/<id>/approve/  owner only
GET    /api/expenses/summary/       totals by category
```

Checkout prices each line server-side from the product's own selling/wholesale
price and bulk rules. A client-supplied `unit_price` is honoured for counter
discounts, but totals are always recomputed from the lines — the client can't
send a total that disagrees with what was sold.

## Tests

```sh
python manage.py test
```

31 tests covering stock movement, checkout atomicity, overselling, bulk and
wholesale pricing, voiding, tenant isolation, forged workspace headers, role
permissions and expense approval.

To run them without Postgres:

```sh
DATABASE_URL="sqlite:///test-run.sqlite3" python manage.py test
```
