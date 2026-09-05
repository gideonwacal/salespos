# Deploying SalesPos

Three free services, in this order. Each step depends on the one before it, so
don't skip ahead — the API needs the database URL, and the frontend needs the
API URL.

| Piece | Host | Free tier |
| --- | --- | --- |
| Postgres | [Neon](https://neon.tech) | Permanent. Autosuspends when idle. |
| Django API | [Render](https://render.com) | Permanent, but **sleeps after 15 min idle** |
| Frontend | [Vercel](https://vercel.com) | Permanent, no sleep |

> **Read this before a real shop uses it.** Render's free tier spins down after
> 15 minutes of no traffic, and the next request takes 30–60 seconds to wake it.
> At a till, with a customer waiting, that is unusable. Free is right for a demo,
> a pilot you drive yourself, or showing an investor. Before a shop trades on it,
> upgrade the Render service to Starter (~$7/month) — that one change removes the
> sleep. Everything else can stay free.

---

## 0. Push the code to GitHub

Both Render and Vercel deploy from a repository.

```sh
git add -A
git commit -m "Prepare for deployment"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

---

## 1. Postgres on Neon

1. Sign in at **neon.tech** with GitHub.
2. **Create project** — name it `salespos`, pick the region closest to your
   shops (Frankfurt or Singapore are the nearest to East Africa), Postgres 17.
3. On the project dashboard, open **Connection string**.
4. Switch the toggle to **Pooled connection**, then copy it. It looks like:

   ```
   postgresql://user:PASSWORD@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

**Use the pooled string, not the direct one.** Django opens a connection per
worker and holds it (`conn_max_age=600`); the direct endpoint runs out of
connections, the pooler does not.

Keep this string — step 2 needs it.

---

## 2. Django API on Render

1. Sign in at **render.com** with GitHub.
2. **New → Blueprint**, pick your repository. Render reads
   [`render.yaml`](render.yaml) and proposes a service called
   `salespos-api`. Approve it.
3. It will fail its first deploy — expected, two env vars are still blank.
4. Open the service → **Environment**, and set:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | the pooled Neon string from step 1 |
   | `CORS_ALLOWED_ORIGINS` | leave blank for now — step 3 gives you the value |

   `DJANGO_SECRET_KEY` is generated for you, `DJANGO_DEBUG=0` and
   `DJANGO_ALLOWED_HOSTS` are already set by the blueprint.

5. **Manual Deploy → Deploy latest commit.**

The build runs [`backend/build.sh`](backend/build.sh): installs dependencies,
`collectstatic`, then `migrate`. Migrations run at build time, so the app never
comes up against a schema older than the code.

**Check it:** open `https://salespos-api.onrender.com/api/auth/me/`. A
`{"detail":"Authentication credentials were not provided."}` with status 401 is
success — the API is up and refusing anonymous access, exactly as it should.

Copy that base URL.

### Create your first account

The database is empty. Either sign up through the app once step 3 is done, or
seed a demo shop from **Render → Shell**:

```sh
python manage.py seed_demo --email you@yours.com --password 'a-strong-password'
```

---

## 3. Frontend on Vercel

1. Sign in at **vercel.com** with GitHub.
2. **Add New → Project**, import your repository.
3. Settings:

   | Field | Value |
   | --- | --- |
   | Framework Preset | **Other** |
   | Root Directory | `./` (leave as the repo root) |
   | Build Command | `npm run build` |
   | Output Directory | **leave empty** |
   | Install Command | `npm install` |

   Leave Output Directory empty on purpose. The build emits
   `.vercel/output` — Vercel's Build Output API v3 — which Vercel finds by
   itself. Naming a directory here breaks it.

4. **Environment Variables** — add before the first deploy, because Vite inlines
   it at build time and changing it later needs a rebuild:

   | Key | Value |
   | --- | --- |
   | `VITE_API_URL` | `https://salespos-api.onrender.com/api` |

   Include `/api`, no trailing slash.

5. **Deploy.**

You get a URL like `https://salespos.vercel.app`.

---

## 4. Join the two together

The API still rejects the browser, because it doesn't know the frontend yet.

1. Render → your service → **Environment** → set:

   ```
   CORS_ALLOWED_ORIGINS = https://salespos.vercel.app
   ```

   No trailing slash. Add every domain you use, comma-separated, including a
   custom one later.

2. Save. Render redeploys automatically.

**Check it:** open your Vercel URL, go to **Create business**, and sign up. If
the account is created and you land in the setup wizard, all three services are
talking to each other.

---

## When something is wrong

| What you see | Cause |
| --- | --- |
| "Could not create the account" / network error in the browser console | `CORS_ALLOWED_ORIGINS` doesn't exactly match your Vercel URL, or has a trailing slash |
| First request takes ~50s, then works | Render free tier waking up. Expected. Upgrade to remove it. |
| `DisallowedHost` in Render logs | `DJANGO_ALLOWED_HOSTS` missing the Render hostname |
| Admin page loads unstyled | `collectstatic` didn't run — check the build log |
| `too many connections` from Postgres | You used Neon's direct string; switch to the pooled one |
| Frontend builds but every page 404s | Output Directory was set; clear it |

---

## Before real money runs through it

1. **Take your own backups.** No free tier gives you restores you control. Neon
   → **Backups**, or run `pg_dump` on a schedule. A shop's sales history is not
   something to lose.
2. **Remove the Render sleep** (~$7/month). See the warning at the top.
3. **Move logos off the database.** Business logos and damage photos are stored
   as base64 data URIs in Postgres. They inflate every row, every backup, and
   every API response. Cloudflare R2's free 10GB is the fix.
4. **Turn on HSTS** once HTTPS is settled: set `DJANGO_HSTS_SECONDS=31536000` on
   Render. Off by default because it tells browsers to refuse plain http for a
   year and is painful to undo.
