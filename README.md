# Brothers Gym — Gym Management System

Brothers Gym manages memberships and daily operations for two gym locations in
Delhi. Members can sign up and pay through the public website. Owners and staff
use a branch-scoped admin panel to manage members, plans, payments, renewals,
equipment, employees, trainers and reviews.

**Status:** live at [brothersgym.in](https://brothersgym.in), deployed by Netlify
from GitHub's `main` branch. Each branch uses its own Razorpay merchant account. If checkout is
unavailable, the site records a call-back lead without charging the member.
`PAYMENT_MODE=contact` disables online payments site-wide. Owners normally see
only their own branch; a super-admin can access both.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Server Components, Server Actions) |
| Language | TypeScript 5.9 |
| Database | PostgreSQL |
| ORM | Drizzle ORM 0.45 + drizzle-kit migrations |
| Styling | Tailwind CSS v4 (CSS-first configuration, no `tailwind.config`) |
| Auth | bcryptjs password hashing + `jose`-signed JWT session cookie |
| Payments | Razorpay checkout with one merchant account per branch; owner-contact fallback when checkout is unavailable |
| Email | Resend for transactional OTP and alerts |
| SMS | MSG91 with DLT templates; off at launch — see Known gaps |
| Exports / import | ExcelJS (`.xlsx`) and jsPDF (`.pdf`); spreadsheet import |
| Captcha | Cloudflare Turnstile |

## Public site

- **Landing page (`/`):** full-bleed hero, BMI calculator, tabbed trainer and owner
  profiles per branch, star-rated member reviews, branch picker with Google Maps
  links, and a floating WhatsApp button.
- **`/join`:** a membership wizard covering branch, plan, details and payment.
  Members pay through the selected branch's Razorpay account. Payment capture
  creates the membership and Gym ID, with on-screen confirmation and an email
  if the member supplied an address. If checkout is unavailable, nothing is
  charged. The member receives the branch's phone and WhatsApp details, a
  reference code (`BG-<branch>-<id>`), and a status page (`/join/status`);
  the owner receives a call-back lead to settle in person.
  Plans can be filtered by **with cardio** or **without cardio ("Hardcore")**,
  with 1 / 3 / 6 / 12-month durations. The wizard supports new memberships and
  renewals. Renewals verify the existing Gym ID against its registered phone
  number before allowing payment. Health-data consent includes a timestamp and IP.
- **`/contact`:** contact details for each branch.
- **`/privacy`, `/terms`, `/refund`:** privacy, membership terms and refund policies
  to publish before launch.
- **`/api/health`:** a database-ping health check that returns `{ ok: true }` or
  `503` for uptime monitoring and post-deploy smoke tests.
- **SEO:** generated `sitemap` and `robots`, OpenGraph and Twitter card images,
  and optional Google Search Console verification.

## Admin panel

Admin login paths are configurable through environment variables; see Secrets
below. In local development, the defaults are `/login` for staff and
`/owner-login` for owners.

| Route | Purpose |
| --- | --- |
| `/admin` | Owner accounts for a selected 15th-to-14th cycle, searchable payments and expenses, received-date corrections, expense editing, collection methods and current membership status; branch-scoped or all-branches |
| `/admin/history` | Changes with the responsible account and before/after values; automatically removed after 31 days |
| `/admin/join-requests` | Owner-only queue for online joins where no gateway payment was taken. A navigation badge counts open leads. Marking a lead paid creates the membership and provides a WhatsApp link to send the Gym ID |
| `/admin/members` | Create, view, edit and delete members; search; renew from today or the previous due date with a date preview; record departures and returns; show or hide columns; manage branch-specific Gym IDs; export Excel/PDF |
| `/admin/inactive` | Expired, lapsed and departed members, filtered by how overdue they are, with a one-tap win-back action |
| `/admin/plans` | Branch-specific plans and prices, with or without cardio and durations of 1–12 months; activate or deactivate plans |
| `/admin/reminders` | Expiry reminders with prefilled WhatsApp messages; MSG91 SMS is integrated but off at launch |
| `/admin/import` | Spreadsheet member import with preview and validation |
| `/admin/equipment` | Equipment inventory and cost records with Excel/PDF export |
| `/admin/trainers` | Trainer and owner profiles for the public site |
| `/admin/reviews` | Public member reviews, including rating, visibility and ordering |
| `/admin/staff` | Employee records for trainers, workers and cleaners, with salary tracking and export |
| `/admin/users` | Admin accounts and per-feature permissions |
| `/admin/branch` | Branch address, phone, map link and owner contact |
| `/admin/security` | Login-attempt log and session activity |

### Member lifecycle

Members can join in person or online. Renewals extend the expiry date and record
a payment. Lapsed members appear on the inactive page, grouped by how overdue
they are. Departures are recorded with a reason: shifted, not interested, health,
financial or other. Restoring a departed member records the return timestamp.

Each member has a payment history. Payments are recorded as cash, UPI, Razorpay
or other, so staff can record in-person renewals alongside online payments.

Renewals record the actual received date independently of the membership period.
Owners can correct manually recorded receipt dates from the dashboard. A payment
received on 13 November and entered on 16 November counts in the 15 October–14
November cycle. Corrections keep the amount, original entry timestamp and member
expiry intact, and record the actor and date change in History. Verified gateway
payments retain their automatic dates. Historical payroll uses current active
staff rates and scheduled paydays, as stated on the dashboard.

### Roles and branch access

The system has two roles, **owner** and **staff**, with per-feature permissions
and a separate branch scope.

Owner accounts are normally assigned to one branch. They can manage that gym's
members, plans, payments, staff and join requests; they cannot view or change the
other branch's data. Each write loads the target row and checks its `branchId`
against the caller's scope. An out-of-scope row returns the same message as a
missing row, preventing the panel from revealing the other branch's IDs.

The `ADMIN_EMAIL` super-admin has no assigned branch and can switch between
both gyms. This account supports administration and the two shared surfaces,
including the homepage testimonial pool. That pool has one owner-curator; the
other branch has read-only access.

Scope depends on branch assignment, not the role name. Clearing an owner's
`branch_id` restores that account's all-branches access.
`BRANCH_SCOPED_OWNERS=false` restores the previous all-branches behaviour for
everyone. The flag is read on each request, so these changes do not require a
redeploy or a new login.

Staff accounts are assigned to one branch. The owner controls access to sections,
actions (view / add / edit / delete), and individual member fields through a JSON
permission record on the account. Middleware protects every admin route and
redirects unauthenticated requests before fetching data.

## Data model

Drizzle defines 16 PostgreSQL tables, with branch scoping where applicable:

| Table | Holds |
| --- | --- |
| `branches` | The two gym locations: code, address, phone, map URL and owner |
| `members` | Branch-specific Gym ID, plan, expiry, health consent, departure and return state |
| `payments` | Cash, UPI, Razorpay and other payments linked to a member and branch |
| `membership_plans` | Branch-specific plans: with/without cardio × 1 / 3 / 6 / 12 months |
| `online_joins` | Sign-up ledger with pending / claimed / paid / rejected / failed states, Razorpay order and payment IDs, and the member's `BG-<branch>-<id>` reference |
| `enquiries` | Branch-specific leads, contact details, follow-up dates, last contact, contact count and conversion to membership |
| `trainers` | Public trainer and owner profiles |
| `staff` | Employees (trainer / worker / cleaner) and salary |
| `equipment_expenses` | Equipment inventory and costs |
| `app_users` | Owner and staff accounts with JSON permissions |
| `reviews` | Member ratings, visibility and display order |
| `activity_logs` | Dashboard changes with branch, account identity, event, previous/new values and timestamp |
| `login_otps` | Email OTP codes for owner login and password reset |
| `login_attempts` | Login attempts with IP, user-agent and outcome |
| `rate_limit_attempts` | IP and per-email rate-limit counters |
| `sms_logs` | MSG91 messages, status and cost |

## Engineering notes

### Payment verification

The browser sends a `planCode`, never a payment amount. The server looks up the
price, records the expected amount on the join row, and creates the Razorpay
order. Editing a price in the browser cannot change the amount charged.

A payment is accepted only when all three checks pass:

1. The HMAC-SHA256 signature over `order_id|payment_id` verifies against the
   branch's key secret using `crypto.timingSafeEqual` rather than `===`.
2. Razorpay's API confirms that the payment is `captured`.
3. The captured amount matches the recorded amount.

Fulfilment uses a Postgres advisory lock and a compare-and-swap to handle
concurrent browser callbacks and webhooks; see Double-submit safety below.

### Branch-specific merchant accounts

Each branch resolves its Razorpay credentials from `RAZORPAY_KEY_ID_<CODE>` so
payments settle to that owner's bank account.

- **Shared-key fallback is disabled when suffixed keys exist.** Once any
  branch-suffixed key is configured, the unsuffixed key is ignored. A
  misconfigured branch cannot silently fall back to another owner's account.
- **Webhooks check the order's branch.** A valid signature identifies the account
  that sent the event. The handler also checks that the order belongs to that
  branch, preventing either owner from submitting a signed `payment.captured`
  event for the other owner's order.
- **Credentials stay in environment variables.** They are kept out of database
  columns accessible to the admin panel. Key rotation does not require a
  database update.

### Double-submit safety

A join is fulfilled through an atomic conditional update,
`UPDATE ... WHERE status IN ('pending','claimed') RETURNING`, used as a
compare-and-swap behind a per-join advisory lock.

The browser callback and webhook can report the same capture in either order,
at the same time, or again through webhook retries. Only the first update
succeeds; subsequent updates match zero rows. This prevents duplicate memberships
and ledger rows. The same guard handles an owner double-clicking
**Money received** on a call-back lead.

Only the successful caller sends the confirmation email, after the guard passes,
preventing duplicate confirmation emails.

### Branch-specific Gym IDs

Each branch numbers members independently from 1, using `MAX(gym_id) + 1`.
A `(branch_id, gym_id)` unique constraint rejects collisions if sign-ups race.

### Membership fulfilment

Membership creation goes through `src/lib/fulfil-join.ts`:

- `fulfilPaidJoin` handles verified gateway payments from the browser callback
  and webhook.
- `fulfilManualJoin` handles call-back leads settled in person, reached only
  through the owner-only confirmation action.

The module stays in plain `lib/` and does not use `"use server"`. Next.js exposes
exports from a `"use server"` file as callable HTTP endpoints; membership grants
must be reached through callers that have already verified the payment or
authenticated the owner.

Required membership data is validated and saved on the join row when the request
is created. Fulfilment reads that stored data without sending it back through the
browser.

Webhook verification uses a different HMAC from checkout verification. It signs
the raw request body with the branch's `RAZORPAY_WEBHOOK_SECRET_<CODE>`,
rather than the API key secret. The handler reads the body as text because JSON
parsing and re-serialising can change the signed bytes.

### Email limits

OTP and password-reset requests send email before checking a secret. The free
Resend tier allows 100 messages per day, shared with owner login codes. An
attacker can rotate IP addresses and exhaust that quota without guessing a
password.

A separate 24-hour limit allows 10 sends per email address. It counts actual
sends and remains in place after a successful login. Keying this limit to the
target address prevents an attacker from bypassing it by changing IPs.

### Performance

Public pages are tuned for a first visit on a mid-range phone using mobile data:

- **Homepage caching:** ISR renders the page statically and revalidates hourly
  (`revalidate = 3600`). Independent reads for branches, trainers and reviews run
  together in `Promise.all`.
- **Self-hosted fonts:** `next/font` serves Inter and Outfit with `display: swap`,
  avoiding a render-blocking stylesheet from Google's CDN. Pages download only
  the font files they use.
- **Hero media:** `next/image` serves the poster as AVIF/WebP with `priority`
  because it is the largest paint element. The ~4.7 MB background video mounts
  only on fast, non-metered connections detected through the Network Information
  API, and never when the OS requests reduced motion.
- **Client-side navigation:** `next/link` provides prefetched transitions between
  pages without full-page reloads.

### Secrets

Members enter card and bank credentials in Razorpay's hosted modal; those
credentials do not reach this app. Each branch's Key ID is public by design:
the browser uses it to identify the merchant account.

Key Secrets and webhook secrets are read only in `"use server"` files and route
handlers. They are never prefixed `NEXT_PUBLIC_`, logged or returned to the
client. They live in environment variables, outside the `branches` table and
database backups. Production error messages pass through a sanitiser that removes
stack traces and database details.

Admin login paths are stored only in `OWNER_LOGIN_PATH` and `STAFF_LOGIN_PATH`
environment variables, outside the committed source. In production, middleware
rewrites the configured paths to the internal login routes and redirects direct
requests to `/login` or `/owner-login` to the homepage. Hidden paths add
obscurity; authentication, permissions and the controls below provide the
security boundary.

### Other security measures

- Login rate limiting: 5 attempts per IP within 15 minutes, followed by a
  30-minute block. An atomic database upsert keeps the limit across serverless
  cold starts. The separate per-address email cap applies as well.
- Email OTP as a second factor for owner login.
- A 3-day sliding session: the signed token is re-issued on every admin request.
  Continued use extends the session; 3 days of inactivity expires it. Cookies use
  `httpOnly` and `secure`.
- Sessions are signed and validated against the database, so editing a cookie
  does not grant a role.
- Cloudflare Turnstile on login and password reset.
- Failed-login email alerts to the owner.
- A Content Security Policy that includes Razorpay hosts at build time and
  excludes them entirely when `PAYMENT_MODE=contact`.
- Parameterised Drizzle queries to prevent SQL injection.

### Mobile

The admin panel supports phone use on the gym floor. Each table has a card-list
view below `md` and a table view above it. Tap targets are at least 44px. Mobile
inputs, including the `/join` form, use a 16px base size to prevent iOS Safari from
zooming on focus.

## Local setup

```bash
git clone <repo-url>
cd gym-management-website-guide
npm install

cp .env.example .env      # then fill in real values

npx drizzle-kit migrate   # create the schema by replaying drizzle/*.sql
npm run dev               # http://localhost:3000
```

Use `migrate` for this project's database setup. It replays the journaled files
in `drizzle/` (`0000_`–`0018_`) in order, preserving a reproducible migration
history. `push` compares `src/db/schema.ts` directly with the database and
applies the differences without recording migrations; it can drop columns it
does not recognise. See `scripts/BACKUP.md` for taking a dump first.

`.env.example` documents required and optional variables. Without configured
secret login paths, local admin login is available at `/login` for staff and
`/owner-login` for owners.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run audit:check` | Run `npm audit` for high severity and above |
| `npm run audit:full` | Run the full `npm audit` |
| `npm run db:backup` | Dump the database to `backups/` (gitignored); options: `-- --keep N`, `-- --label NAME` |
| `npm run db:restore` | Restore a dump; **drops and recreates every table** — see `scripts/BACKUP.md` |

## Dashboard history

Owners can open **History** from the menu or **Recent changes** from the
dashboard. Its configured activation time is **19 November 2026 at 12:00 pm
IST** (06:30 UTC). The server checks this time on every request. Navigation,
the history page, recording and cleanup stay disabled before activation, even
if Netlify deploys the code early. Once this build is live, activation does not
require another deployment.

The filters **Today**, **This week** (Monday onward), **This month**, and
**Last 31 days** use Indian time. Owners can also filter by account and change
type. Entries show member edits with previous/new values, renewals, equipment
purchases and corrections, and other dashboard changes. Each entry retains the
signed-in account's name and role even if the account is later deleted. Branch
owners see only their own gym's history; staff cannot open the page.

Tracking requires migration `0018_activity_history.sql` and this version of the
application. Before deployment, run `npx drizzle-kit migrate` to create
`activity_logs`.

On Netlify production deployments, `cleanup-activity` runs hourly and deletes
history entries older than 31 days. Set `DATABASE_URL` for both the build and
Netlify Functions, including the scheduled function. Opening History also
performs cleanup. Other hosts must schedule the SQL from
`src/lib/activity-retention.ts` hourly to clean up while the dashboard is idle.
Cleanup deletes only activity entries; member, payment and equipment-expense
records remain intact.

## Known gaps

- **Razorpay accounts await approval.** The gateway code is complete, but neither
  branch's merchant account has been approved. Each owner needs separate KYC
  with their own PAN and bank proof. Until keys are configured, that branch's
  members receive the owner-contact screen and become call-back leads without
  being charged. The site can launch with this fallback while KYC is pending.
- **Webhooks have not been tested against live traffic.** Register each branch's
  `POST /api/webhooks/razorpay/<CODE>` endpoint in that account's dashboard for
  `payment.captured` events only. Without `RAZORPAY_WEBHOOK_SECRET_<CODE>`,
  the branch endpoint returns `503` and refuses unsigned callbacks. A member
  who closes the tab immediately after paying would therefore not be activated
  automatically. The unsuffixed `/api/webhooks/razorpay` endpoint returns `410`
  to identify stale dashboard registrations.
- **Member email requires domain verification.** Resend's shared
  `onboarding@resend.dev` sender delivers only to the Resend account owner's
  address; other recipients receive a `403`. Admin OTP works because it goes
  to that address. Member confirmations require `brothersgym.in` to be verified
  at resend.com/domains.
- **SMS reminders need configuration.** The MSG91 send path and `sms_logs`
  table are in place, but DLT templates still need approval. Launch reminders
  use WhatsApp links.
- **Error monitoring requires configuration.** `@sentry/nextjs` is integrated
  through `instrumentation.ts` for server and edge, `withSentryConfig` in
  `next.config.ts`, and a `/monitoring` tunnel to avoid ad-blocker interference.
  Reporting is inactive until `NEXT_PUBLIC_SENTRY_DSN` is set. See
  `.env.example` for that variable and `SENTRY_ORG` / `SENTRY_PROJECT` /
  `SENTRY_AUTH_TOKEN`.
- **The background video needs compression.**
  `public/videos/gym-background.mp4` is still served as-is at ~4.7 MB.
  Connection checks limit which visitors download it, but the file itself
  remains unoptimised.

## Data and credentials

This project was built for a client. The repository contains no real credentials
or member data. `.env` is gitignored; the committed `.env.example` contains
placeholders.

## Author

**Pushkar**

- LinkedIn: [pushkar-kumar](https://linkedin.com/in/pushkar-kumar-893a94323)
- Email: pushkark123456@gmail.com
