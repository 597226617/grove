/**
 * Exponential backoff with full jitter.
 *
 * Based on the AWS Architecture Blog recommendation:
 * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 *
 * Full jitter produces: sleep = random_between(0, min(cap, base * 2^attempt))
 * This prevents thundering herd when multiple agents retry simultaneously.
 */

/** Default base delay in milliseconds (10 seconds). */
export const DEFAULT_BASE_DELAY_MS = 10_000;

/** Default maximum backoff cap in milliseconds (5 minutes). */
export const DEFAULT_MAX_BACKOFF_MS = 300_000;

/** Default maximum retry attempts. */
export const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Compute a backoff delay with full jitter.
 *
 * @param attempt - Zero-based attempt number (0 = first retry).
 * @param baseMs - Base delay in milliseconds.
 * @param capMs - Maximum delay cap in milliseconds.
 * @returns Delay in milliseconds, uniformly distributed in [0, min(capMs, baseMs * 2^attempt)).
 */
export function computeBackoffMs(
  attempt: number,
  baseMs: number = DEFAULT_BASE_DELAY_MS,
  capMs: number = DEFAULT_MAX_BACKOFF_MS,
): number {
  const exponentialMs = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exponentialMs);
}

/**
 * Check whether a claim should be retried based on attempt count and policy.
 *
 * @param attemptCount - Number of attempts already made.
 * @param maxAttempts - Maximum allowed attempts.
 * @returns true if more retries are available.
 */
export function canRetry(
  attemptCount: number,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): boolean {
  return attemptCount < maxAttempts;
}
