import { isRetryTimeBudgetExhausted } from './retry-budget';

describe('isRetryTimeBudgetExhausted', () => {
  test('no time limit (0) is never exhausted, even after a long time', () => {
    expect(isRetryTimeBudgetExhausted(0, 0)).toBe(false);
    expect(isRetryTimeBudgetExhausted(10_000_000, 0)).toBe(false);
  });

  test('a negative budget is treated as no limit', () => {
    expect(isRetryTimeBudgetExhausted(5_000, -1)).toBe(false);
  });

  test('not exhausted while elapsed is below the budget', () => {
    expect(isRetryTimeBudgetExhausted(4_999, 5_000)).toBe(false);
  });

  test('exhausted exactly at the budget', () => {
    expect(isRetryTimeBudgetExhausted(5_000, 5_000)).toBe(true);
  });

  test('exhausted once elapsed exceeds the budget', () => {
    expect(isRetryTimeBudgetExhausted(7_500, 5_000)).toBe(true);
  });

  test('stops on whichever limit is reached first (duration before attempts)', () => {
    // Simulate a loop that would run more attempts but is capped by duration.
    const budgetMs = 1_000;
    const elapsedPerAttempt = 400;
    let attempts = 0;
    const maxAttempts = 10;
    let elapsed = 0;
    while (
      attempts < maxAttempts &&
      !isRetryTimeBudgetExhausted(elapsed, budgetMs)
    ) {
      attempts += 1;
      elapsed += elapsedPerAttempt;
    }
    // 0ms ok, 400ms ok, 800ms ok, 1200ms exhausted -> 3 attempts ran.
    expect(attempts).toBe(3);
  });
});
