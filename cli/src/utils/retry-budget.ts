/**
 * Decide whether the retry loop should stop because the total time budget has
 * been used up.
 *
 * The retry command stops when *either* the per-entry attempt cap or this total
 * duration limit is reached. A `maxTotalRetryTime` of 0 (or negative) means
 * "no time limit" — only the attempt cap applies, preserving the original
 * behaviour. Otherwise retries stop once the elapsed wall-clock time reaches the
 * budget, even if attempts remain (useful during long network outages).
 *
 * @param elapsedMs         milliseconds elapsed since retrying started
 * @param maxTotalRetryTime total retry time budget in milliseconds (0 = unlimited)
 */
export function isRetryTimeBudgetExhausted(
  elapsedMs: number,
  maxTotalRetryTime: number
): boolean {
  return maxTotalRetryTime > 0 && elapsedMs >= maxTotalRetryTime;
}
