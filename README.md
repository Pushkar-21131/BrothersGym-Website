# Brothers Gym — Gym Management System

A full-stack, multi-branch gym management platform built for a real two-location
gym in Delhi. The public side takes membership sign-ups with online payment; the
admin side gives the owner and staff a role-separated panel for members, plans,
payments, renewals, equipment, staff, trainers and reviews — scoped per branch.

**Status:** feature-complete; pre-launch. Not yet deployed to a
production domain. Online joins go through **Razorpay checkout, with a separate
merchant account per branch** so each gym's money settles to its own owner — the
membership activates itself on payment capture. When a branch has no keys configured
or checkout can't run, nothing is charged and the member becomes a **call-back lead**
in that owner's admin queue, reachable by phone and WhatsApp. `PAYMENT_MODE=contact`
turns online payment off site-wide. Each owner's dashboard is **scoped to their own
branch**, with a single super-admin retaining the all-branches view. A recent pass
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
| Payments | Razorpay checkout, one merchant account per branch; contact-the-owner fallback when the gateway can't run |
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
  pick a branch, pick a plan, fill in details, then pay through **Razorpay** — the
  branch's own merchant account, so the money reaches that gym's owner. The membership
  and Gym ID are created automatically on payment capture, confirmed on screen and by
  email if an address was given. If the gateway can't run, **nothing is charged**: the
  member gets the branch's phone and WhatsApp plus a reference code
  (`BG-<branch>-<id>`) and a self-serve status page (`/join/status`), and the owner
  gets a call-back lead to settle in person. Plans come in
  two families —
  **with cardio** and **without ("Hardcore")** — each in 1 / 3 / 6 / 12-month
  durations, filterable. Handles both **new members** and **renewals**: a renewal
  first verifies an existing Gym ID against its registered phone number before any
  payment is allowed. Health-data consent is captured with a timestamp and IP.
- **`/contact`** — branch-wise contact details.
- **`/privacy`, `/terms`, `/refund`** — the policy pages a membership business
  should publish before going live.
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
| `/admin/join-requests` | Owner-only — the call-back queue: online joins where **no** gateway payment was taken. A nav badge counts the open ones; marking one paid creates the membership and reveals a one-tap WhatsApp link to send the Gym ID |
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
| `/admin/branch` | Branch details (address, phone, map link, owner contact) |
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

Two roles, **owner** and **staff**, with per-feature permissions on top, and a branch
scope orthogonal to both.

Each gym has its own owner, so an owner account is normally **pinned to one branch**: they
get full owner powers over their own gym — members, plans, payments, staff, join requests —
and the other branch's data is neither visible nor writable. Writes are checked row by row
(load the row, compare its `branchId` against the caller's scope, then write), and an
out-of-scope target returns the same message as a row that does not exist, so the panel
cannot be used to enumerate the other gym's IDs.

One account has **no branch** and keeps the all-branches view with a branch switcher — the
`ADMIN_EMAIL` super-admin, kept for support and for the two shared surfaces that cannot be
split (the homepage testimonial pool has one owner-curator; the other branch sees it
read-only). Scoping keys off whether a row has a branch assigned rather than off a role
name, which is what makes the undo cheap: clear one owner's `branch_id` and they are
unscoped again, or set `BRANCH_SCOPED_OWNERS=false` to restore the old all-branches
behaviour for everyone. That flag is read per request, so neither undo needs a redeploy or
a re-login.

Staff accounts are locked to one branch and see a reduced panel — the owner controls
exactly which sections and actions (view / add / edit / delete, and even which member
*fields*) each staff account can reach, stored as a JSON permission blob on the account.
Every admin route is gated in middleware, so an unauthenticated request is redirected
before any data is fetched.

---

## Data model

Fourteen tables, all branch-scoped where it matters (Drizzle over PostgreSQL):

| Table | Holds |
| --- | --- |
| `branches` | The two gym locations (code, address, phone, map URL, owner) |
| `members` | Member records — per-branch Gym ID, plan, expiry, health consent, left-gym / win-back state |
| `payments` | Every payment — cash / UPI / Razorpay / other — linked to member and branch |
| `membership_plans` | Per-branch plans (with/without cardio × 1 / 3 / 6 / 12 months) |
| `online_joins` | The online sign-up ledger — pending / claimed / paid / rejected / failed; holds the Razorpay order and payment IDs, and the `BG-<branch>-<id>` reference the member quotes |
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
plan's price, records the expected amount on the join row, and creates the Razorpay
order for that amount itself — so a tampered price in the browser cannot buy a
membership.

Verification is layered on top: a payment is accepted only if (1) the HMAC-SHA256
signature over `order_id|payment_id` verifies against **that branch's** key secret,
compared with `crypto.timingSafeEqual` rather than `===`, (2) Razorpay's own API
confirms the status is `captured`, and (3) the captured amount matches the recorded
amount. Fulfilment then runs behind a Postgres advisory lock with a compare-and-swap,
so the browser callback and the webhook arriving together still produce exactly one
membership, one ledger row and one email.

### Per-branch merchant accounts

Each branch resolves its own Razorpay credentials from `RAZORPAY_KEY_ID_<CODE>`, so
payments settle to the right owner's bank account. Three decisions exist purely to stop
money reaching the wrong person:

- **No shared fallback key.** Once any suffixed key exists, an unsuffixed one is
  ignored. A fallback would mean a misconfigured branch silently charging into the
  other owner's account — invisible until a bank statement is reconciled.
- **A cross-branch guard on the webhook.** A valid signature proves the delivery came
  from the account owning that URL, not that the order belongs to that branch. Without
  the guard, either owner could sign a well-formed `payment.captured` naming the
  other's order.
- **Credentials in env vars, not a database column.** A live key secret in a table the
  admin panel can read is a far larger blast radius, and rotating a leaked key
  shouldn't need a database write.

### Double-submit safety

Fulfilling a join is an atomic conditional update —
`UPDATE ... WHERE status IN ('pending','claimed') RETURNING` — used as a
compare-and-swap behind a per-join advisory lock. Razorpay reports a capture twice by
design (the browser callback and the webhook, either order, sometimes simultaneously,
plus webhook retries), so this is the normal case rather than an edge case: the second
update matches zero rows and is rejected instead of creating a duplicate member. The
same guard covers the owner double-clicking **Money received** on a call-back lead.

Because only the race winner gets a success back, the confirmation email is sent
*after* that guard — which is what makes it exactly one email rather than two.

### Per-branch Gym IDs

Each branch numbers its members from 1 independently, allocated as `MAX(gym_id) + 1`
within the branch and backed by a `(branch_id, gym_id)` unique constraint, so the
database rejects a collision even if two sign-ups race.

### One fulfilment module, guarded callers

Granting a membership always goes through one module (`src/lib/fulfil-join.ts`):
`fulfilPaidJoin` for a gateway payment (reached by the browser callback and by the
webhook) and `fulfilManualJoin` for a call-back lead the owner settles in person
(reached only from the owner-only confirm action). That module is deliberately **not** a
`"use server"` file: in Next.js every export from one becomes a callable HTTP endpoint,
and these functions grant memberships. Keeping it in plain `lib/` means it can only be
reached through code that has already authorised the grant — a verified payment, or an
authenticated owner confirming.

Everything the membership needs is written to the join row when the request is
created, where it has just been validated. Nothing round-trips through the browser
and comes back.

The webhook signature is a **different** HMAC from the checkout one: it is computed over
the raw request body using that branch's `RAZORPAY_WEBHOOK_SECRET_<CODE>`, not the API
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

Card and bank credentials never reach this app — the member enters them inside
Razorpay's own hosted modal. What the app does hold is a **Key ID** per branch, which is
public by design (the checkout script runs in the browser and it only identifies which
account receives the money), and a **Key Secret** and **webhook secret** per branch, which
are read exclusively inside `"use server"` files and route handlers, never prefixed
`NEXT_PUBLIC_`, and never logged or returned to the client. They live in environment
variables rather than a `branches` column, so an over-broad admin query or a database
backup cannot leak the ability to charge cards. All error messages pass through a
sanitiser that strips stack traces and database details in production.

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
- Content Security Policy scoped tight — the Razorpay hosts are spliced in at build time
  and dropped entirely when `PAYMENT_MODE=contact`, so a deployment that takes no online
  payment ships no gateway origins at all
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

- **The Razorpay accounts are not live yet.** The gateway code is complete, but each
  branch needs its own merchant account with its own KYC (each owner's own PAN and bank
  proof), and neither is approved. Until a branch's keys are set, its members are shown
  the contact-the-owner screen and become call-back leads — nothing is charged, so this
  is a soft gap rather than a broken flow, and it is why the site can deploy before KYC
  clears.
- **The webhook has never fired against live traffic.** Each branch has its own endpoint
  (`POST /api/webhooks/razorpay/<CODE>`, `payment.captured` only) and it must be
  registered in that account's own dashboard. Until `RAZORPAY_WEBHOOK_SECRET_<CODE>` is
  set, that branch's endpoint answers `503` deliberately — refusing is safer than
  accepting unsigned callbacks — which means a member who closes the tab the instant they
  pay would not be activated automatically. The unsuffixed `/api/webhooks/razorpay`
  answers `410` so a stale dashboard entry fails loudly instead of 404-ing.
- **Member emails stay dark until the domain is verified.** Resend's shared
  `onboarding@resend.dev` sender only delivers to the address that owns the Resend
  account; everyone else gets a `403`. Admin OTP works today because it goes to that
  address. Member confirmations need `brothersgym.in` verified at resend.com/domains.
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
