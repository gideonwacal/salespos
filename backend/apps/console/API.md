# Platform API — tracking every business from your own dashboard

The console in `console/` is only one client of this API. Anything that can
send an HTTP request and hold a token can be your control room.

Base URL: `https://salespos-api.onrender.com/api`

Every field below is taken from `apps/console/views.py`. Where a response is a
bare array it is a bare array, not `{results: [...]}` — the two differ by
endpoint and are marked.

## Signing in

```http
POST /api/auth/login/
{"email": "you@example.com", "password": "..."}

→ 200 {"access": "<jwt>", "refresh": "<jwt>"}
```

Send `Authorization: Bearer <access>` on every console call.

**Access tokens last 60 minutes**, refresh tokens 14 days, and refresh tokens
rotate — each refresh returns a new one, and the old one stops working. A
dashboard that holds the first refresh token for ever will be logged out the
first time it tries to use it twice.

```http
POST /api/auth/refresh/
{"refresh": "<jwt>"}

→ 200 {"access": "<jwt>", "refresh": "<new jwt>"}
```

Every `/api/console/*` endpoint requires `is_superuser`. A signed-in shop owner
gets **403**, not an empty list. `GET /api/auth/me/` tells you which you are:
check `user.is_superuser` before showing anyone a control room.

### Before your dashboard can call this at all

Its origin has to be in the API's CORS list, or the browser blocks the request
before Django ever sees it. On Render, append it:

```
CORS_ALLOWED_ORIGINS = https://salespos.vercel.app,https://your-dashboard.example.com
```

No trailing slash, and the scheme matters. A server-side dashboard calling from
its own backend needs none of this — CORS is a browser rule.

## The endpoints

### `GET /api/console/overview/` — the numbers for a landing page

```jsonc
{
  "businesses": 42,
  "states": {
    "trial": 5, "paying": 12, "expired": 20, "free": 3,
    "suspended": 1, "referral_grace": 1,
    "unreviewed": 7          // counted separately: not a billing state
  },
  "users": 61,
  "active_users_7d": 18,
  "signups_30d": 9,
  "pending_payments": 2,
  "revenue_total": "725000",  // strings, not numbers — they are decimals
  "revenue_month": "150000",
  "activity_24h": 340,
  "referrals": {
    "signups": 14, "signups_30d": 6, "link_opens": 88,
    "grace_granted": 3, "referring_businesses": 5
  },
  "recent_activity": [ /* 15 activity rows, newest first */ ]
}
```

### `GET /api/console/businesses/` — every business

Query: `?search=` (name, email, phone, or any member's email) and `?state=`
(`trial` `paying` `expired` `free` `suspended` `referral_grace` `unreviewed`).

Returns a **bare array**:

```jsonc
[{
  "id": "uuid", "name": "Nakawa Traders", "industry": "wholesale",
  "city": "Kampala", "phone": "...", "email": "...",
  "owner": "owner@example.com",        // the owner's email, or null
  "plan": "standard", "access": "standard",
  "state": "trial",                     // the derived state, see below
  "trial_ends": "2026-11-07T...", "paid_until": null,
  "members": 3,                         // active memberships
  "last_activity": "2026-10-24T...",    // newest ActivityLog row, or null
  "reviewed_at": null, "created_at": "2026-10-24T..."
}]
```

`state` is derived, not stored, and the order it is decided in matters:
suspended → (billing off ⇒ free) → free → paying → trial → referral_grace →
expired. `access` is the stored setting you can change; `state` is what that
setting plus the clock currently add up to.

### `GET /api/console/businesses/<id>/` — one business in full

Everything in the list row, plus `tagline`, `address`, `country`, `currency`,
`access_note`, `subscribed`, `configured`, `reviewed_by`, and:

```jsonc
{
  "stats": {
    "sales": 310, "sales_total": "18400000",
    "sales_30d": 44, "products": 148
  },
  "members": [{ "id", "user_id", "email", "full_name", "phone",
                "role", "active", "user_active", "last_login" }],
  "payments": [ /* every subscription payment, newest first */ ],
  "activity": [ /* last 100 activity rows for this business */ ],
  "referral": {
    "code": "BQ7MX2K",
    "opens": 23, "total_opens": 41,   // distinct people vs. every open
    "signups": 4, "needed": 5,
    "grace_granted_at": null, "grace_until": null, "grace_active": false,
    "referred_by": { "id", "name", "joined" },   // or null
    "businesses": [{ "id", "name", "joined", "subscribed" }]
  }
}
```

`referred_by` is worth putting on screen. Five sibling businesses that all
arrived the same afternoon and never sold anything is somebody minting
accounts to unlock their own, and that field is how you would see it.

### `PATCH /api/console/businesses/<id>/` — change a business's standing

Accepts any of `access` (`standard` `free` `suspended`), `access_note`, `plan`,
`subscribed`, `trial_ends`, `paid_until`, `referral_grace_until`. Dates take
ISO strings; a bare date becomes 23:59 that day. Returns the full detail
payload. Every change is written to the activity log as the platform owner.

This is how you grant somebody free access, extend a trial, or take back a
referral grace given in error.

### `POST /api/console/businesses/<id>/review/`

Marks a business as looked at. Not an approval — nothing was ever held waiting
for it. `→ {"id", "reviewed_at"}`

### `GET /api/console/users/` — bare array

`?search=` over email, name and phone. Each row carries `businesses[]` with
the workspaces that user belongs to and their role in each.

### `PATCH /api/console/users/<id>/` — block or restore a sign-in

`{"is_active": false}`. Refuses to block your own account or another platform
owner. `→ {"id", "is_active"}`

### `GET /api/console/payments/` — bare array

`?status=pending|approved|rejected`, `?limit=` (default 200, max 500),
`?offset=`.

```jsonc
[{
  "id": "uuid", "workspace": "Nakawa Traders", "workspace_id": "uuid",
  "submitted_by": "owner@example.com",   // or null
  "plan": "standard", "months": 3,
  "amount": "25000", "currency": "UGX",
  "payer_phone": "0772000111", "transaction_id": "TX1",
  "status": "pending", "note": "",
  "reviewed_at": null, "created_at": "2026-10-24T..."
}]
```

### `POST /api/console/payments/<id>/approve/` · `/reject/`

Approving activates the plan and stacks the months onto whatever time is left.
Rejecting takes an optional `{"note": "..."}`. Either is refused with **400**
if the payment is not still `pending`. Returns the updated payment row.

### `GET /api/console/activity/` — the audit trail

`?workspace=` `?user=` `?search=` `?limit=` (default 100, max 500) `?offset=`.

The one endpoint that does **not** return a bare array:

```jsonc
{ "results": [ /* rows */ ], "has_more": true }
```

Every write a shop makes through the API lands here, plus every sign-in and
every decision you take in a console. `by_platform: true` marks the ones you
made yourself.

## Things to know before you build against it

**`/businesses/` has no pagination and no limit.** It loads every workspace,
then derives and filters `state` in Python rather than in SQL. Fine for tens
of businesses, slow at thousands. If your dashboard is meant to scale past
that, say so and it is worth moving the state filter into the query.

**Responses are never cached.** Every console view sets no-cache headers, so
your dashboard decides its own refresh rate. The bundled console polls the
overview every 30 seconds.

**Money comes back as strings.** `"725000"`, not `725000`. They are database
decimals and JSON numbers would lose precision on large totals. Parse before
you add them up.

**Timestamps are ISO 8601 in UTC.** Businesses keep their own timezone in
`workspace.timezone` (default `Africa/Kampala`) — convert for display, or your
"today" will be three hours out.

**The free Render plan spins down when idle.** The first request after a quiet
spell can take 30–60 seconds. Give your dashboard's fetches a generous timeout
and do not treat one slow response as the API being down.
