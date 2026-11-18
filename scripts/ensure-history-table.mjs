import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Client } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

// Apply only the additive history migration. A release must not replay unrelated
// legacy migrations against a production database that was provisioned manually.
const migration = readFileSync(new URL("../drizzle/0018_activity_history.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
const entry = journal.entries.find((item) => item.tag === "0018_activity_history");
const previous = journal.entries.find((item) => item.idx === entry.idx - 1);
const expectedColumns = {
  id: "integer", branch_id: "integer", actor_user_id: "integer",
  actor_name: "text", actor_role: "text", event: "text", subject_id: "integer",
  details: "text", changes: "jsonb", created_at: "timestamp with time zone",
};
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000 });

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL search_path = public");
  await client.query("SELECT pg_advisory_xact_lock(1819112026)");
  const { rows: columns } = await client.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activity_logs'",
  );
  if (columns.length && JSON.stringify(Object.fromEntries(columns.map((c) => [c.column_name, c.data_type]).sort())) !==
      JSON.stringify(Object.fromEntries(Object.entries(expectedColumns).sort()))) {
    throw new Error("Existing activity_logs schema differs from the expected history table; no changes applied");
  }
  await client.query(migration.replaceAll('CREATE TABLE "activity_logs"', 'CREATE TABLE IF NOT EXISTS "activity_logs"')
    .replaceAll("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS "));

  const { rows: [tracking] } = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists");
  if (tracking.exists) {
    const { rows: [latest] } = await client.query("SELECT max(created_at)::text AS latest FROM drizzle.__drizzle_migrations");
    if (Number(latest.latest) === previous.when) {
      await client.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
        [createHash("sha256").update(migration).digest("hex"), entry.when]);
      console.log("Registered the history migration in the existing Drizzle ledger.");
    }
  }
  await client.query("COMMIT");
  console.log(columns.length ? "Production history table and indexes verified." : "Production history table and indexes created.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
