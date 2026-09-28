#!/usr/bin/env node
/**
 * Database backup — `pg_dump` piped through gzip into ./backups, then pruned.
 *
 * WHY THIS EXISTS
 * Every delete path in this app is deliberate and permission-gated, but several
 * are irreversible at the database level: deleting a member removes the row, and
 * a hand-run `DELETE` in psql has no undo at all. Nothing here prevents that.
 * This is the recovery side — a real dump you can restore from.
 *
 * WHY pg_dump AND NOT A JS EXPORT
 * A backup is only worth the restore it enables. `pg_dump` emits a complete,
 * self-contained SQL script that rebuilds types, constraints, indexes and
 * sequences, and it is the one format every Postgres tool can read. A hand-rolled
 * row-by-row export (especially of the base64 `bytea` proof images) loses
 * fidelity in exactly the situation you would need it.
 *
 * WHY --clean --if-exists
 * So the dump restores in ONE command against an existing database, which is the
 * situation an emergency restore always is. The trade-off is explicit: restoring
 * this file DROPS the tables it contains first. See scripts/BACKUP.md.
 *
 * USAGE
 *   npm run db:backup               # dump to backups/, keep the last 14
 *   npm run db:backup -- --keep 30  # keep more
 *   node scripts/backup-db.mjs --label before-import
 *
 * Connection comes from DATABASE_URL (shell env, else .env). Override the
 * pg_dump binary with PG_DUMP=/path/to/pg_dump.
 */

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "backups");
const DEFAULT_KEEP = 14;
const FILE_PREFIX = "brothers-gym-";
const FILE_SUFFIX = ".sql.gz";

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opts = { keep: DEFAULT_KEEP, label: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keep") opts.keep = Number(argv[++i]);
    else if (a === "--label") opts.label = String(argv[++i] ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
    else if (a === "--quiet") opts.quiet = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(opts.keep) || opts.keep < 0) {
    console.error("--keep must be a number >= 0");
    process.exit(2);
  }
  return opts;
}

// ------------------------------------------------------------- pg_dump path

/**
 * Locate `pg_dump`.
 *
 * On Windows the PostgreSQL client is not on PATH by default — it installs into
 * `C:\Program Files\PostgreSQL\<major>\bin`, and the project's own tooling has
 * needed the absolute path before. Check the newest majors first: `pg_dump`
 * refuses to dump a server NEWER than itself, so picking the highest version
 * installed is the one most likely to work against a hosted database.
 */
function findPgDump() {
  if (process.env.PG_DUMP) return process.env.PG_DUMP;
  if (process.platform === "win32") {
    for (const major of [18, 17, 16, 15]) {
      const candidate = `C:\\Program Files\\PostgreSQL\\${major}\\bin\\pg_dump.exe`;
      if (existsSync(candidate)) return candidate;
    }
  }
  return "pg_dump"; // resolve via PATH; spawn fails loudly if absent
}

// ---------------------------------------------------------------- connection

/**
 * Split DATABASE_URL into discrete connection parts.
 *
 * Deliberately NOT passed to pg_dump as a single URL argument: a URL carries the
 * password, and an argument is visible to any other process on the machine via
 * the process list. The password goes through PGPASSWORD in the child's
 * environment instead, which is not readable that way.
 */
function parseDatabaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    console.error("DATABASE_URL is not a valid URL.");
    process.exit(1);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !database) {
    console.error("DATABASE_URL is missing a host or database name.");
    process.exit(1);
  }
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    // A hosted database (Neon and friends) requires TLS. pg_dump reads PGSSLMODE,
    // so forward whatever the URL asked for rather than forcing a mode, which
    // would break a local 127.0.0.1 database that has no TLS at all.
    sslmode: url.searchParams.get("sslmode") || "",
  };
}

async function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Imported lazily, and only on this branch: when DATABASE_URL comes from the
  // environment (CI, a one-off shell) this script needs no node_modules at all,
  // so a scheduled backup has nothing to install before it can run.
  const dotenv = await import("dotenv");
  // dotenv does not override an already-set process.env value, so the shell wins.
  dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });
  return process.env.DATABASE_URL || "";
}

// -------------------------------------------------------------------- prune

/** Delete the oldest dumps past `keep`. Only ever touches our own filenames. */
function pruneOldDumps(keep, log) {
  if (keep <= 0) return;
  const files = readdirSync(OUT_DIR)
    .filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith(FILE_SUFFIX))
    .sort(); // timestamp format sorts lexicographically == chronologically
  const excess = files.slice(0, Math.max(0, files.length - keep));
  for (const f of excess) {
    unlinkSync(path.join(OUT_DIR, f));
    log(`  pruned  ${f}`);
  }
}

// --------------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(
      "Usage: node scripts/backup-db.mjs [--keep N] [--label TEXT] [--quiet]\n" +
        "  Reads DATABASE_URL from the environment or .env; writes backups/*.sql.gz"
    );
    return;
  }

  const raw = await loadDatabaseUrl();
  if (!raw) {
    console.error(
      "DATABASE_URL is not set (checked the environment and .env).\n" +
        "Refusing to run: a backup with no target is worse than none, because it looks like one."
    );
    process.exit(1);
  }
  const conn = parseDatabaseUrl(raw);
  const log = opts.quiet ? () => {} : (m) => console.log(m);

  mkdirSync(OUT_DIR, { recursive: true });

  // Local time, filename-safe: 2026-09-28-1432
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-") + "-" + [String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0")].join("");
  const filename = `${FILE_PREFIX}${stamp}${opts.label ? "-" + opts.label : ""}${FILE_SUFFIX}`;
  const outPath = path.join(OUT_DIR, filename);

  // Never silently replace a dump: two runs in the same minute would otherwise
  // overwrite, and the second could be the damaged one.
  if (existsSync(outPath)) {
    console.error(`Refusing to overwrite an existing backup: backups/${filename}`);
    process.exit(1);
  }

  const pgDump = findPgDump();
  log(`Backing up ${conn.database}@${conn.host}:${conn.port}`);
  log(`  using   ${pgDump}`);
  log(`  writing backups/${filename}`);

  const args = [
    "-h", conn.host,
    "-p", conn.port,
    "-U", conn.user,
    "-d", conn.database,
    "--no-owner",      // strip role ownership so it restores under any DB user
    "--no-privileges", // likewise for grants; otherwise a restore needs the original roles
    "--clean",         // emit DROP before CREATE …
    "--if-exists",     // … without erroring when the target is empty
  ];

  const child = spawn(pgDump, args, {
    env: {
      ...process.env,
      PGPASSWORD: conn.password,
      ...(conn.sslmode ? { PGSSLMODE: conn.sslmode } : {}),
    },
    windowsHide: true,
  });

  let stderr = "";
  let schemaObjects = 0; // CREATE TABLE count, counted as the bytes stream past
  let carry = "";

  child.stdout.on("data", (chunk) => {
    // Count on the uncompressed text. `carry` holds a partial line across chunk
    // boundaries so a CREATE TABLE split between two chunks is still counted.
    const text = carry + chunk.toString("latin1");
    const lastNl = text.lastIndexOf("\n");
    carry = lastNl === -1 ? text : text.slice(lastNl + 1);
    const matches = (lastNl === -1 ? "" : text.slice(0, lastNl)).match(/^CREATE TABLE /gm);
    if (matches) schemaObjects += matches.length;
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const dumpDone = new Promise((resolve, reject) => {
    child.on("error", (err) =>
      reject(
        new Error(
          `Could not run pg_dump (${pgDump}): ${err.message}\n` +
            "Set PG_DUMP=/full/path/to/pg_dump if it is installed somewhere else."
        )
      )
    );
    child.on("close", (code) => resolve(code));
  });

  const gzipDone = pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(outPath));

  const [code] = await Promise.all([dumpDone, gzipDone]);

  if (code !== 0) {
    // Leave no half-written file behind to be mistaken for a usable backup.
    try { unlinkSync(outPath); } catch { /* already gone */ }
    console.error(`pg_dump failed (exit ${code}):\n${stderr.trim() || "(no stderr)"}`);
    process.exit(1);
  }

  const bytes = statSync(outPath).size;
  const kb = (bytes / 1024).toFixed(0);

  // A dump that "succeeded" but contains no schema is not a backup. This has a
  // real cause here: pg_dump against a server newer than itself, or a connection
  // that reached the wrong (empty) database.
  if (schemaObjects === 0) {
    console.error(
      `pg_dump exited 0 but the dump contains no CREATE TABLE — treating as FAILED.\n` +
        `Check that pg_dump (${pgDump}) is the same or a newer major version than the server.`
    );
    process.exit(1);
  }

  log(`  done    ${kb} KB, ${schemaObjects} tables`);
  if (stderr.trim()) log(`  notes   ${stderr.trim().split("\n")[0]}`);

  pruneOldDumps(opts.keep, log);
  if (opts.keep > 0) log(`  kept    last ${opts.keep} dumps in backups/`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
