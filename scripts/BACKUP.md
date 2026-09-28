# Database backup and restore

The database holds real member data — names, phone numbers, addresses, payment
history. Deletes in this app are deliberate and permission-gated, but several are
irreversible at the database level. This is the recovery side.

## Taking a backup

```bash
npm run db:backup                    # → backups/brothers-gym-<date>-<time>.sql.gz
npm run db:backup -- --keep 30       # keep the last 30 instead of 14
npm run db:backup -- --label before-import
```

The connection comes from `DATABASE_URL` — the shell environment first, then
`.env`. Override the binary with `PG_DUMP=/path/to/pg_dump` if it is not found
automatically.

Each dump is a gzipped plain-SQL script: complete (types, constraints, indexes,
sequences) and readable with `zcat`. Dumps land in `backups/`, which is
**gitignored** — they contain member PII and must never be pushed.

## Automatic backups

`.github/workflows/db-backup.yml` dumps production nightly at 02:17 UTC (07:47
IST) and stores the result as a workflow artifact, kept 90 days.

**One-time setup:** add the production connection string as a repository secret.

```
GitHub repo → Settings → Secrets and variables → Actions → New repository secret
  Name:  DATABASE_URL
  Value: <the same connection string Netlify uses>
```

Until that secret exists the workflow fails at the Dump step. That is deliberate:
a backup job that silently does nothing is worse than one that is visibly broken.

You can also trigger a run by hand — **Actions → Database backup → Run workflow** —
which is worth doing before anything risky: a bulk import, a cleanup script, a
schema change.

## Restoring

```bash
npm run db:restore -- backups/brothers-gym-2026-09-28-1201.sql.gz --yes
```

**This drops and recreates every table in the dump.** Anything written since the
dump was taken is lost. That is correct for a recovery and wrong for "let me look
at some old data" — for that, restore into a *different* database instead
(see below).

The `--yes` flag is mandatory. It is a flag rather than an interactive prompt
because this may be run from a script, and a prompt that defaults to "yes" when
stdin is closed is not a guard at all.

The restore stops at the first error (`ON_ERROR_STOP=1`). If it fails partway the
database is left partially restored — **do not start the app** until you have
re-run it or restored an earlier dump.

After restoring, restart the dev server so it discards cached connections.

## Restoring somewhere safe first

To inspect an old dump without touching the live database, restore it into a
throwaway database and delete it afterwards:

```bash
psql "$ADMIN_URL" -c "CREATE DATABASE restore_check;"
DATABASE_URL="postgres://…/restore_check" node scripts/restore-db.mjs backups/<file>.sql.gz --yes
psql "$ADMIN_URL" -c "DROP DATABASE restore_check;"
```

This is exactly how the backup path was verified: a dump was restored into a
scratch database and the table and row counts compared against the source.

## Things worth knowing

**A backup you have never restored is not a backup.** The scripts were tested
end-to-end (schema, row counts and values all matched), but re-test after any
change to the database or to these scripts — restoring into a scratch database
costs nothing.

**Requires a `pg_dump` at least as new as the server.** `pg_dump` refuses to dump
a *newer* server. The scripts pick the highest major version installed locally
(15–18); CI installs the newest from PGDG. A version mismatch is the most likely
cause of a backup that fails on a machine where it used to work.

**90 days is the artifact limit.** GitHub deletes artifacts after the retention
window, so a loss discovered later than that has no artifact to fall back on. If
you want a longer history, download a dump periodically and keep it somewhere
offline, or add a step to copy it to separate storage.

**Not covered by these dumps:** uploaded trainer photos live in the database as
base64, so they *are* included. Anything stored outside Postgres is not.
