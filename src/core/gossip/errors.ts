/**
 * Gossip-specific error types.
 *
 * Extends the Grove error hierarchy so the server error handler can
 * map these to appropriate HTTP status codes.
 */

import { GroveError } from "../errors.js";

/** Thrown when a gossip peer is unreachable (connection refused, DNS failure). */
export class PeerUnreachableError extends GroveError {
  readonly peerId: string;
  readonly address: string;

  constructor(opts: { peerId: string; address: string; cause?: Error }) {
    super(`Peer ${opts.peerId} at ${opts.address} is unreachable`);
    this.name = "PeerUnreachableError";
    this.peerId = opts.peerId;
    this.address = opts.address;
    if (opts.cause) this.cause = opts.cause;
  }
}

/** Thrown when a gossip exchange times out waiting for a response. */
export class GossipTimeoutError extends GroveError {
  readonly peerId: string;
  readonly timeoutMs: number;

  constructor(opts: { peerId: string; timeoutMs: number }) {
    super(`Gossip exchange with peer ${opts.peerId} timed out after ${opts.timeoutMs}ms`);
    this.name = "GossipTimeoutError";
    this.peerId = opts.peerId;
    this.timeoutMs = opts.timeoutMs;
  }
}
