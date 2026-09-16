# Control Room — SalesPos platform console

The platform owner's private site. It is a separate app from the shop system:
its own code, its own look, its own address, its own sign-in. The only thing
it shares with the shop app is the Django API, and every `/api/console/`
endpoint refuses anyone who is not a superuser.

What it does:

- **Overview** — businesses, users, revenue, payments waiting, live activity.
- **Businesses** — every shop, its status, staff, sales, payments and history.
  Decide each one's access: **Standard** (trial, then pay), **Free** (no
  subscription needed) or **Suspended** (locked out). Change plan, extend the
  trial, set a paid-until date.
- **Users** — everyone with a login; block or restore sign-in.
- **Payments** — approve or reject MTN MoMo subscription payments.
- **Activity** — every change, sign-in and decision, searchable.

## Run it locally

The Django API must be running (`backend/`, port 8000).

```sh
cd console
npm install        # first time only
cp .env.example .env
npm run dev        # http://localhost:8090
```

Sign in with a superuser account. Create one with:

```sh
cd backend
python manage.py createsuperuser
```

## Deploy it

Deploy as its own static site, e.g. a second Vercel project:

| Field | Value |
| --- | --- |
| Root Directory | `console` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Env var `VITE_API_URL` | `https://<your-api>/api` |

Then add the console's URL to `CORS_ALLOWED_ORIGINS` on the API, next to the
shop app's URL.

Keep the address to yourself. It is not linked from the shop app, it tells
search engines not to index it, and sign-in is rate limited — but the real
protection is a strong superuser password.

## Security notes

- Sessions live in `sessionStorage`: closing the tab signs you out.
- A non-superuser who signs in is signed straight back out.
- Every decision you take is written to the activity log with your account.
