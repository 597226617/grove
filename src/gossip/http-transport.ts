/**
 * HTTP-based gossip transport.
 *
 * Implements GossipTransport using Bun's built-in fetch() for
 * server-to-server communication. Uses standard keep-alive for
 * connection reuse.
 */

import { GossipTimeoutError, PeerUnreachableError } from "../core/gossip/errors.js";
import type {
  GossipMessage,
  GossipTransport,
  PeerInfo,
  ShuffleRequest,
  ShuffleResponse,
} from "../core/gossip/types.js";

/** Configuration for the HTTP gossip transport. */
export interface HttpTransportConfig {
  /** Request timeout in milliseconds (default: 10_000). */
  readonly timeoutMs?: number | undefined;
}

/** Default request timeout: 10 seconds. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * HTTP-based GossipTransport.
 *
 * Sends gossip messages as JSON POST requests to peer grove-servers.
 * Uses Bun's built-in fetch() with default keep-alive for connection reuse.
 */
export class HttpGossipTransport implements GossipTransport {
  private readonly timeoutMs: number;

  constructor(config?: HttpTransportConfig) {
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async exchange(peer: PeerInfo, message: GossipMessage): Promise<GossipMessage> {
    const url = `${peer.address}/api/gossip/exchange`;
    const response = await this.post<GossipMessage>(url, message, peer.peerId);
    return response;
  }

  async shuffle(peer: PeerInfo, request: ShuffleRequest): Promise<ShuffleResponse> {
    const url = `${peer.address}/api/gossip/shuffle`;
    const response = await this.post<ShuffleResponse>(url, request, peer.peerId);
    return response;
  }

  private async post<T>(url: string, body: unknown, peerId: string): Promise<T> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new PeerUnreachableError({
            peerId,
            address: url,
            cause: new Error(`HTTP ${response.status}: ${response.statusText}`),
          });
        }

        return (await response.json()) as T;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      if (err instanceof PeerUnreachableError || err instanceof GossipTimeoutError) {
        throw err;
      }

      // AbortError from timeout
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new GossipTimeoutError({ peerId, timeoutMs: this.timeoutMs });
      }

      // Network errors (connection refused, DNS failure, etc.)
      throw new PeerUnreachableError({
        peerId,
        address: url,
        cause: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }
}
