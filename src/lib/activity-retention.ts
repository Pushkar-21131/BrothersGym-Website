import { HISTORY_RETENTION_DAYS } from "./activity-history";

// Shared by the history page and the scheduled function. This targets only
// activity entries; membership, payment and expense records have their own lifetime.
export const DELETE_EXPIRED_ACTIVITY_SQL =
  `DELETE FROM activity_logs WHERE created_at <= CURRENT_TIMESTAMP - INTERVAL '${HISTORY_RETENTION_DAYS} days'`;
