#!/usr/bin/env node
/**
 * Database restore — replay a dump from ./backups into DATABASE_URL.
 *
 * READ THIS BEFORE RUNNING IT
 * The dumps are written with `--clean --if-exists`, so restoring DROPS every
 * table the dump contains and recreates it. Any row written since the dump was
 * taken is gone. That is the correct behaviour for a recovery (you want the
 * database back as it was, not merged with the damage) and exactly the wrong
 * behaviour for "let me just look at some old data".
 *
 * So this refuses to run without an explicit --yes. The confirmation is a flag
 * rather than a prompt on purpose: this may well be run from a script or a
 * terminal where an interactive prompt is not seen, and a prompt that defaults
 * to "yes" when stdin is closed is not a guard at all.
 *
 * USAGE
 *   npm run db:restore -- backups/brothers-gym-2026-09-28-1201.sql.gz --yes
 *   node scripts/restore-db.mjs backups/<file>.sql.gz --yes
 */

import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function findPsql() {
  if (process.env.PSQL) return process.env.PSQL;
  if (process.platform === "win32") {
    for (const major of [18, 17, 16, 15]) {
      const candidate = `C:\\Program Files\\PostgreSQL\\${major}\\bin\\psql.exe`;
      if (existsSync(candidate)) return candidate;
    }
  }
  return "psql";
}

/** Same reasoning as backup-db.mjs: the password goes through the environment. */
function parseDatabaseUrl(raw) {
  const url = new URL(raw);
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
    sslmode: url.searchParams.get("sslmode") || "",
  };
}

async function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Lazy, as in backup-db.mjs: no node_modules needed when the URL is in the env.
  const dotenv = await import("dotenv");
  dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });
  return process.env.DATABASE_URL || "";
}

async function main() {
  const argv = process.argv.slice(2);
  const confirmed = argv.includes("--yes");
  const fileArg = argv.find((a) => !a.startsWith("--"));

  if (!fileArg) {
    console.error(
      "Usage: node scripts/restore-db.mjs <file.sql.gz> --yes\n\n" +
        "  Available dumps in backups/:\n" +
        "    (run `ls backups/` — listing is left to the shell so this stays dependency-free)"
    );
    process.exit(2);
  }

  const file = path.resolve(ROOT, fileArg);
  if (!existsSync(file)) {
    console.error(`No such dump: ${file}`);
    process.exit(1);
  }

  const raw = await loadDatabaseUrl();
  if (!raw) {
    console.error("DATABASE_URL is not set (checked the environment and .env).");
    process.exit(1);
  }
  const conn = parseDatabaseUrl(raw);

  console.log("About to restore:");
  console.log(`  dump   ${path.relative(ROOT, file)}`);
  console.log(`  INTO   ${conn.database}@${conn.host}:${conn.port}`);
  console.log("");
  console.log("  Restoring DROPS and recreates every table in the dump.");
  console.log("  Anything written since the dump was taken will be lost.");

  if (!confirmed) {
    console.log("");
    console.error("Refusing to continue without --yes.");
    console.error("Re-run with --yes once you are certain this is the right target.");
    process.exit(2);
  }

  const psql = findPsql();
  console.log("");
  console.log(`Restoring with ${psql} …`);

  const child = spawn(
    psql,
    [
      "-h", conn.host,
      "-p", conn.port,
      "-U", conn.user,
      "-d", conn.database,
      // Abort on the first error. Without this psql reports the failure and
      // carries on, which can leave the database half-restored — the worst
      // possible outcome, because it looks like it worked.
      "-v", "ON_ERROR_STOP=1",
      "-q",
    ],
    {
      env: {
        ...process.env,
        PGPASSWORD: conn.password,
        ...(conn.sslmode ? { PGSSLMODE: conn.sslmode } : {}),
      },
      windowsHide: true,
    }
  );

  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  child.stdout.on("data", () => { /* psql -q is quiet; swallow anything left */ });

  const isGzip = file.endsWith(".gz");
  const source = createReadStream(file);
  const body = isGzip ? source.pipe(createGunzip()) : source;

  try {
    await pipeline(body, child.stdin);
  } catch (err) {
    console.error(`Failed streaming the dump into psql: ${err.message}`);
    process.exit(1);
  }

  const code = await new Promise((resolve, reject) => {
    child.on("error", (err) =>
      reject(new Error(`Could not run psql (${psql}): ${err.message}\nSet PSQL=/full/path/to/psql.`))
    );
    child.on("close", resolve);
  });

  if (code !== 0) {
    console.error(`Restore FAILED (psql exit ${code}):`);
    console.error(stderr.trim() || "(no stderr)");
    console.error("");
    console.error("The database may be partially restored. Do not start the app until");
    console.error("this is resolved — re-run the restore, or restore an earlier dump.");
    process.exit(1);
  }

  if (stderr.trim()) console.log(stderr.trim());
  console.log("");
  console.log("Restore complete. Restart the dev server so it drops any cached connections.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
