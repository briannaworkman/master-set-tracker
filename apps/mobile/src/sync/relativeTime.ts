const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * How long ago `iso` was, for "Synced …": "just now" under a minute (or in the future, from clock
 * skew), "5 min ago" under an hour, "2 h ago" under a day, otherwise a short local date ("Nov 14").
 */
export function formatSyncedAgo(iso: string, now: number): string {
  const then = Date.parse(iso);
  const elapsed = now - then;
  if (!(elapsed >= MINUTE)) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  const d = new Date(then);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
