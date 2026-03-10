/**
 * Background worker abstraction.
 *
 * Simple start/stop protocol for periodic background tasks.
 * Used by the gossip service and potentially the reconciler.
 */

/** Protocol for background workers. */
export interface BackgroundWorker {
  /** Start the background loop. Idempotent. */
  start(): void;
  /** Stop the background loop. Returns when fully stopped. */
  stop(): Promise<void>;
}
