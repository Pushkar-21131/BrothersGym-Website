# Brothers Gym — Gym Management System

A full-stack, multi-branch gym management platform built for a real two-location
gym in Delhi. The public side takes membership sign-ups with online payment; the
admin side gives the owner and staff a role-separated panel for members, plans,
payments, renewals, equipment, staff, trainers and reviews — scoped per branch.

**Status:** feature-complete and building clean; pre-launch. Not yet deployed to a
production domain. Online joins use a **manual UPI + owner-confirmation** flow by
default (no payment gateway, no KYC): the member pays by UPI and the owner confirms
receipt in the admin panel to activate the membership. The Razorpay checkout is kept
parked behind a `PAYMENT_MODE` flag and can be switched back on. A recent pass
tightened performance (ISR, self-hosted fonts, image/video optimisation) and mobile
ergonomics across the public site.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router, Server Components, Server Actions) |
| Language | TypeScript 5.9 |
| Database | PostgreSQL |
| ORM | Drizzle ORM 0.45 + drizzle-kit migrations |
| Styling | Tailwind CSS v4 (CSS-first config, no `tailwind.config`) |
| Auth | bcryptjs password hashing + `jose`-signed JWT session cookie |
| Payments | Manual UPI + owner confirmation (default); Razorpay checkout parked behind `PAYMENT_MODE` |
| Email | Resend (transactional OTP and alerts) |
| SMS | MSG91 (wired, DLT-template based; off at launch — see Known gaps) |
| Exports / import | ExcelJS (`.xlsx`) and jsPDF (`.pdf`); spreadsheet import |
| Captcha | Cloudflare Turnstile |

---

## What the public site does

- **Landing page (`/`)** — full-bleed hero, a BMI calculator, tabbed trainer and
  owner profiles per branch, member reviews with star ratings, a branch picker with
  Google Maps links, a floating WhatsApp button, and a cookie-consent banner.
- **`/join` — online membership** — a guided wizard (branch → plan → details → pay):
  pick a branch, pick a plan, fill in details, then pay by **UPI** — scan the QR or
  tap "Open in UPI app" (amount pre-filled) and pay straight to the gym's UPI ID. The
  member gets an instant on-screen acknowledgement with a reference code
  (`BG-<branch>-<id>`) and a self-serve status page (`/join/status`); the owner
  confirms the payment in the admin panel to activate the membership. Plans come in
  two families —
  **with cardio** and **without ("Hardcore")** — each in 1 / 3 / 6 / 12-month
  durations, filterable. Handles both **new members** and **renewals**: a renewal
  first verifies an existing Gym ID against its registered phone number before any
  payment is allowed. Health-data consent is captured with a timestamp and IP.
- **`/contact`** — branch-wise contact details.
- **`/privacy`, `/terms`, `/refund`** — the policy pages a membership business
  should publish before going live; they describe the manual-UPI payment reality.
- **`/api/health`** — a database-ping health check (`{ ok: true }` or `503`) for
  uptime monitoring and post-deploy smoke tests.
- **SEO** — generated `sitemap` and `robots`, OpenGraph and Twitter card images,
  optional Google Search Console verification.

## What the admin panel does

Reached through hidden, unguessable login URLs (see *Secrets* below); in local dev
these fall back to `/login` (staff) and `/owner-login` (owner).

| Route | Purpose |
| --- | --- |
| `/admin` | Owner dashboard — revenue, active / expiring members, salary outgo; per-branch or all-branches |
| `/admin/join-requests` | Owner-only — online UPI join requests to confirm or reject; a nav badge counts the open ones, and confirming creates the membership and reveals a one-tap WhatsApp link to send the Gym ID |
| `/admin/members` | Member CRUD, search, renewals, mark-left / won-back, column show/hide, per-branch Gym IDs, Excel/PDF export |
| `/admin/inactive` | Expired, lapsed and left-gym members, filterable by how overdue, with one-tap win-back |
| `/admin/plans` | Membership plans and pricing per branch (with/without cardio, 1–12 months); activate/deactivate a plan |
| `/admin/reminders` | Expiry reminders with prefilled WhatsApp messages (MSG91 SMS is wired but off at launch) |
| `/admin/import` | Bulk member import from a spreadsheet, with preview and validation |
| `/admin/equipment` | Equipment inventory and cost records, with Excel/PDF export |
| `/admin/trainers` | Trainer and owner profiles shown on the public site |
| `/admin/reviews` | Member reviews shown on the public site (rating, visibility, ordering) |
| `/admin/staff` | Employee records (trainer / worker / cleaner) and salary, with export |
| `/admin/users` | Admin accounts and per-feature permissions |
| `/admin/branch` | Branch details (address, phone, map link, owner, UPI ID for online payments) |
| `/admin/security` | Login-attempt log and session activity |

### Member lifecycle

A member is more than a row. The panel tracks the whole arc: **join** (in person or
online), **renew** (extends the expiry and records a payment), **lapse** (surfaced
on the inactive page, bucketed by how overdue), **leave** (marked with a reason —
shifted / not interested / health / financial / other), and **win back**
(un-marking a left member is timestamped). Every member carries a payment history,
and payments are recorded by method — **cash, UPI, Razorpay or other** — so the
desk can log an over-the-counter renewal the same way an online one lands.

### Roles

Two roles, **owner** and **staff**, with per-feature permissions on top. The owner
has no branch (sees and switches across all of them); each staff account is locked
to one branch. Staff see a reduced panel — the owner controls exactly which sections
and actions (view / add / edit / delete, and even which member *fields*) each staff
account can reach, stored as a JSON permission blob on the account. Every admin
route is gated in middleware, so an unauthenticated request is redirected before any
data is fetched.

---

## Data model

Fourteen tables, all branch-scoped where it matters (Drizzle over PostgreSQL):

| Table | Holds |
| --- | --- |
| `branches` | The two gym locations (code, address, phone, map URL, owner) |
| `members` | Member records — per-branch Gym ID, plan, expiry, health consent, left-gym / win-back state |
| `payments` | Every payment — cash / UPI / Razorpay / other — linked to member and branch |
| `membership_plans` | Per-branch plans (with/without cardio × 1 / 3 / 6 / 12 months) |
| `online_joins` | The online sign-up ledger — pending / claimed / paid / rejected / failed; holds the member's UPI reference (and Razorpay order IDs when the gateway is on) |
| `trainers` | Public trainer and owner profiles |
| `staff` | Employees (trainer / worker / cleaner) with salary |
| `equipment_expenses` | Equipment inventory and cost |
| `app_users` | Admin accounts (owner / staff) with a JSON permissions blob |
| `reviews` | Member reviews (rating, visibility, display order) |
| `login_otps` | Email OTP codes for owner login and password reset |
| `login_attempts` | Audit log of every login attempt (IP, user-agent, outcome) |
| `rate_limit_attempts` | IP and per-email rate-limit counters |
| `sms_logs` | MSG91 send log (message, status, cost) |

---

## Engineering notes

The parts of this build that took the most thought.

### Payments are server-authoritative

The browser never sends an amount. It sends a `planCode`; the server looks up that
plan's price, records the expected amount on the join row, and builds the UPI QR and
`upi://` string (payee, amount, reference) itself. The member pays that exact amount
to the gym's UPI ID, and the **owner confirms receipt** against their own bank record
before the membership is created — a tampered price in the browser cannot buy a
membership, because the amount shown and confirmed is the server's, never the
client's.

When `PAYMENT_MODE=razorpay`, the parked gateway path adds automatic verification on
top: the payment is accepted only if (1) the HMAC-SHA256 signature over
`order_id|payment_id` verifies against the key secret, compared with
`crypto.timingSafeEqual` rather than `===`, (2) Razorpay's own API confirms the
status is `captured`, and (3) the captured amount matches the recorded amount.

### Double-submit safety

Marking an open join as paid is an atomic conditional update —
`UPDATE ... WHERE status IN ('pending','claimed') RETURNING` — used as a
compare-and-swap. If the owner double-clicks Confirm (or, in gateway mode, a Razorpay
payment is submitted twice), the second update matches zero rows and is rejected
instead of creating a duplicate member.

### Per-branch Gym IDs

Each branch numbers its members from 1 independently, allocated as `MAX(gym_id) + 1`
within the branch and backed by a `(branch_id, gym_id)` unique constraint, so the
database rejects a collision even if two sign-ups race.

### One fulfilment module, guarded callers

Granting a membership always goes through one module (`src/lib/fulfil-join.ts`):
`fulfilManualJoin` for the default UPI flow (reached only from the owner-only confirm
action) and `fulfilPaidJoin` for the parked Razorpay flow (reached by the browser
callback and the webhook). That module is deliberately **not** a `"use server"` file:
in Next.js every export from one becomes a callable HTTP endpoint, and these
functions grant memberships. Keeping it in plain `lib/` means it can only be reached
through code that has already authorised the grant — an authenticated owner
confirming, or a verified payment.

Everything the membership needs is written to the join row when the request is
created, where it has just been validated. Nothing round-trips through the browser
and comes back.

In gateway mode the webhook signature is a **different** HMAC from the checkout one:
it is computed over the raw request body using `RAZORPAY_WEBHOOK_SECRET`, not the API
key secret. The body is read as text rather than JSON because parsing and
re-stringifying changes the bytes and the signature no longer matches.

### Per-address email cap

Every other limit here is keyed on IP, and IPs are disposable. But OTP and
password-reset requests send an email *before* any secret is checked, and the free
Resend tier allows 100 messages a day — shared with the owner's own login codes. So
an attacker who never guesses a password could still exhaust the quota and lock the
owner out. A separate 24-hour cap (10 sends per address) is keyed on the email
address instead, which is the one part of the request an attacker cannot rotate,
since the target address is the point of the attack. It counts only actual sends,
and is not reset on a successful login, or it would be trivially cleared.

### Performance

The public pages are tuned for a first visit on a mid-range phone on mobile data:

- **The homepage is ISR, not per-request SSR.** It renders statically and
  revalidates hourly (`revalidate = 3600`), and its independent database reads —
  branches, trainers, reviews — run in a single `Promise.all` rather than in series.
- **Fonts are self-hosted through `next/font`** (Inter, Outfit, `display: swap`), so
  the first paint no longer waits on a render-blocking stylesheet from Google's CDN.
  The font files are only downloaded on the pages that actually use them.
- **The hero poster is served via `next/image`** as AVIF/WebP with `priority` (it is
  the largest paint element), and the ~4.7 MB background video is only mounted on
  fast, non-metered connections (Network Information API) — and never when the OS
  asks for reduced motion. Previously every mobile visitor downloaded the whole clip.
- **In-app navigation uses `next/link`** for instant, prefetched client-side
  transitions instead of full-page reloads.

### Secrets

In the default manual-UPI mode there is no payment secret at all — the member pays
inside their own UPI app and the app never touches card or bank credentials. When the
Razorpay gateway is switched on, its **Key ID** is public by design (the checkout
script runs in the browser and it only identifies which account receives the money),
while the **Key Secret** is read exclusively inside `"use server"` files, never
prefixed `NEXT_PUBLIC_`, and never logged or returned to the client. All error
messages pass through a sanitiser that strips stack traces and database details in
production.

The real admin login URLs live **only** in environment variables
(`OWNER_LOGIN_PATH`, `STAFF_LOGIN_PATH`), never in the committed source. In
production the middleware rewrites the secret path onto the internal login route and
bounces any direct hit on the generic route name (`/login`, `/owner-login`) to the
homepage — so neither reading the repo nor guessing the obvious name reveals a
working entrance. This is obscurity, not the security boundary; the real protection
is below.

### Other security measures

- Rate limiting on login — 5 attempts per IP within a 15-minute window, then a
  30-minute block, tracked in the database (via an atomic upsert) rather than in
  memory so it survives a serverless cold start — plus the per-address daily email
  cap above
- Email OTP as a second factor for owner login
- **3-day sliding session** — the signed token is re-issued on every admin request,
  so continuous use never logs you out but 3 days of inactivity does; `httpOnly` +
  `secure` cookies
- Sessions are signed *and* validated against the database, so editing the cookie
  does not grant a role
- Cloudflare Turnstile on login and password reset
- Failed-login email alerts to the owner
- Content Security Policy scoped tight — Turnstile only in the default mode; the
  Razorpay hosts are added to the policy solely when `PAYMENT_MODE=razorpay`
- SQL injection handled by parameterised Drizzle queries

### Mobile

The admin panel is used on phones on the gym floor, so every table renders twice —
a card list below `md` and a real table above it. Tap targets are at least 44px,
and inputs use a 16px base size on mobile — including the `/join` form — because iOS
Safari force-zooms into anything smaller on focus.

---

## Running it locally

```bash
git clone <repo-url>
cd gym-management-website-guide
npm install

cp .env.example .env      # then fill in real values

npx drizzle-kit push      # create the schema
npm run dev               # http://localhost:3000
```

`.env.example` documents every variable the app reads, including which are
required and which are optional. With no secret login paths configured, the admin
login is served directly at `/login` (staff) and `/owner-login` (owner).

### Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run audit:check` | `npm audit` at high severity and above |
| `npm run audit:full` | Full `npm audit` |

---

## Known gaps

Being honest about what is not done, because it is on the roadmap rather than
hidden:

- **Online joins depend on the owner confirming payment.** The default UPI flow has
  no payment gateway, so there is no automatic activation — the owner marks a request
  paid in Admin → Join Requests once the money lands in their UPI account. This is by
  design (no KYC, no fees) and the flow is built around it: instant acknowledgement,
  a reference code, a self-serve status page, and one-tap Call/WhatsApp to the owner.
  The parked Razorpay path (`PAYMENT_MODE=razorpay`) still carries its webhook (`POST
  /api/webhooks/razorpay`, `payment.captured`) for automatic activation, but it stays
  unverified against live traffic until the app is deployed and the endpoint is
  registered — and answers `503` until `RAZORPAY_WEBHOOK_SECRET` is set, deliberately:
  refusing is safer than accepting unsigned callbacks.
- **SMS reminders (MSG91) are wired but unconfigured;** WhatsApp links are used
  instead at launch. The send path and `sms_logs` table exist and are ready to
  switch on once the DLT templates are approved.
- **Error monitoring is not live yet.** `@sentry/nextjs` is installed, but there is
  no instrumentation hook or config, so nothing is being reported. It needs wiring
  before launch.
- **The background video file is still unoptimised** (`public/videos/gym-background.mp4`,
  ~4.7 MB, served as-is). It is no longer downloaded by every visitor — only on
  fast connections (see *Performance*) — but the file itself should still be
  compressed.

---

## Note on data

Built for a client. This repository contains no real credentials and no member
data. `.env` is gitignored; only `.env.example`, which holds placeholders, is
committed.

---

## Author

**Pushkar**

- LinkedIn: [pushkar-kumar](https://linkedin.com/in/pushkar-kumar-893a94323)
- Email: pushkark123456@gmail.com
