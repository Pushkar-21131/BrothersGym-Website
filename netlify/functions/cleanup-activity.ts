import { Pool } from "pg";
import { DELETE_EXPIRED_ACTIVITY_SQL } from "../../src/lib/activity-retention";
import { isHistoryEnabled } from "../../src/lib/history-release";

/** Netlify invokes scheduled functions on production deploys, without a user session. */
export default async function cleanupActivity() {
  if (!isHistoryEnabled()) return;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for history cleanup");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const result = await pool.query(DELETE_EXPIRED_ACTIVITY_SQL);
    console.info(`[History] Deleted ${result.rowCount ?? 0} expired activity entries`);
  } finally {
    await pool.end();
  }
}

export const config = { schedule: "0 * * * *" };
