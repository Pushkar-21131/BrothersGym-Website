// 19 November 2026, 12:00 pm IST. Evaluate per request, so deploying this code
// early prepares the release without showing or recording history before noon.
export const HISTORY_LIVE_AT = Date.parse("2026-11-19T06:30:00Z");

export function isHistoryEnabled(now = Date.now()): boolean {
  return now >= HISTORY_LIVE_AT;
}
