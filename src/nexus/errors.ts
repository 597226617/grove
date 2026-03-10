/**
 * Nexus-specific error classes and error mapping.
 *
 * Maps Nexus/network errors into the Grove error hierarchy so callers
 * handle the same error types regardless of backend.
 */

import { GroveError } from "../core/errors.js";

/** Thrown when the Nexus backend is unreachable. */
export class NexusConnectionError extends GroveError {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "NexusConnectionError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** Thrown when a Nexus operation times out. */
export class NexusTimeoutError extends GroveError {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "NexusTimeoutError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** Thrown when Nexus rejects the request due to authentication/authorization. */
export class NexusAuthError extends GroveError {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "NexusAuthError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** Thrown when a cache CAS operation fails due to revision mismatch. */
export class NexusRevisionConflictError extends GroveError {
  readonly expectedRevision: number;
  readonly actualRevision?: number | undefined;

  constructor(opts: {
    message: string;
    expectedRevision: number;
    actualRevision?: number;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "NexusRevisionConflictError";
    this.expectedRevision = opts.expectedRevision;
    this.actualRevision = opts.actualRevision;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

/**
 * Classify whether an error is retryable (transient) or not.
 *
 * Retryable: connection errors, timeouts, server errors (5xx)
 * Non-retryable: auth errors, validation errors, not-found, conflicts
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof NexusConnectionError) return true;
  if (error instanceof NexusTimeoutError) return true;
  if (error instanceof NexusAuthError) return false;
  if (error instanceof NexusRevisionConflictError) return false;

  // Generic Error — check message for known transient patterns
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("econnrefused") || msg.includes("econnreset")) return true;
    if (msg.includes("timeout")) return true;
    if (msg.includes("503") || msg.includes("429")) return true;
  }

  return false;
}

/**
 * Map a raw error into the appropriate Grove/Nexus error type.
 * Wraps the original error as `.cause` for debugging.
 */
export function mapNexusError(error: unknown, context: string): GroveError {
  if (error instanceof GroveError) return error;

  const msg = error instanceof Error ? error.message : String(error);

  if (msg.includes("ECONNREFUSED") || msg.includes("ECONNRESET") || msg.includes("ENETUNREACH")) {
    return new NexusConnectionError(`Nexus connection failed during ${context}: ${msg}`, error);
  }
  if (msg.toLowerCase().includes("timeout") || msg.includes("ETIMEDOUT")) {
    return new NexusTimeoutError(`Nexus timeout during ${context}: ${msg}`, error);
  }
  if (msg.includes("401") || msg.includes("403") || msg.toLowerCase().includes("unauthorized")) {
    return new NexusAuthError(`Nexus auth failed during ${context}: ${msg}`, error);
  }

  return new NexusConnectionError(`Nexus error during ${context}: ${msg}`, error);
}
