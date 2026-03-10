/**
 * Tests for HttpGossipTransport.
 *
 * Uses a real Bun.serve() HTTP server on port 0 (random available port)
 * to verify exchange/shuffle HTTP requests and error handling.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { GossipTimeoutError, PeerUnreachableError } from "../core/gossip/errors.js";
import type {
  GossipMessage,
  PeerInfo,
  ShuffleRequest,
  ShuffleResponse,
} from "../core/gossip/types.js";
import { HttpGossipTransport } from "./http-transport.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePeer(id: string, address: string): PeerInfo {
  return {
    peerId: id,
    address,
    age: 0,
    lastSeen: new Date().toISOString(),
  };
}

function makeGossipMessage(peerId: string): GossipMessage {
  return {
    peerId,
    frontier: [{ metric: "accuracy", value: 0.95, cid: "blake3:abc123" }],
    load: { queueDepth: 3 },
    capabilities: { platform: "test" },
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

/** Track requests received by the test server. */
let lastRequest: { method: string; path: string; body: unknown } | undefined;
let serverResponseCode: number;
let serverResponseBody: unknown;
/** When set, the server delays its response by this many ms. */
let serverDelayMs: number;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = await req.json().catch(() => null);
      lastRequest = { method: req.method, path: url.pathname, body };

      if (serverDelayMs > 0) {
        await new Promise((r) => setTimeout(r, serverDelayMs));
      }

      return new Response(JSON.stringify(serverResponseBody), {
        status: serverResponseCode,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

beforeEach(() => {
  lastRequest = undefined;
  serverResponseCode = 200;
  serverResponseBody = {};
  serverDelayMs = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HttpGossipTransport", () => {
  // -----------------------------------------------------------------------
  // exchange()
  // -----------------------------------------------------------------------

  describe("exchange()", () => {
    it("sends POST to correct URL with correct body", async () => {
      const transport = new HttpGossipTransport();
      const peer = makePeer("peer-1", baseUrl);
      const message = makeGossipMessage("self");

      const responseMsg: GossipMessage = makeGossipMessage("peer-1");
      serverResponseBody = responseMsg;

      const result = await transport.exchange(peer, message);

      expect(lastRequest).toBeDefined();
      expect(lastRequest?.method).toBe("POST");
      expect(lastRequest?.path).toBe("/api/gossip/exchange");
      expect(lastRequest?.body).toEqual(JSON.parse(JSON.stringify(message)));
      expect(result.peerId).toBe("peer-1");
      expect(result.frontier).toEqual(responseMsg.frontier);
    });

    it("returns parsed GossipMessage from response", async () => {
      const transport = new HttpGossipTransport();
      const peer = makePeer("peer-2", baseUrl);

      const responseMsg: GossipMessage = {
        peerId: "peer-2",
        frontier: [{ metric: "loss", value: 0.01, cid: "blake3:def456" }],
        load: { queueDepth: 7 },
        capabilities: { platform: "linux" },
        timestamp: "2026-01-01T00:00:00.000Z",
      };
      serverResponseBody = responseMsg;

      const result = await transport.exchange(peer, makeGossipMessage("self"));

      expect(result.peerId).toBe("peer-2");
      expect(result.load.queueDepth).toBe(7);
      expect(result.capabilities.platform).toBe("linux");
      expect(result.frontier).toHaveLength(1);
      expect(result.frontier[0]?.metric).toBe("loss");
    });
  });

  // -----------------------------------------------------------------------
  // shuffle()
  // -----------------------------------------------------------------------

  describe("shuffle()", () => {
    it("sends POST to correct URL with correct body", async () => {
      const transport = new HttpGossipTransport();
      const peer = makePeer("peer-3", baseUrl);

      const request: ShuffleRequest = {
        sender: makePeer("self", "http://self:4515"),
        offered: [makePeer("self", "http://self:4515"), makePeer("other", "http://other:4515")],
      };

      const responseShuf: ShuffleResponse = {
        offered: [makePeer("new-peer", "http://new-peer:4515")],
      };
      serverResponseBody = responseShuf;

      const result = await transport.shuffle(peer, request);

      expect(lastRequest).toBeDefined();
      expect(lastRequest?.method).toBe("POST");
      expect(lastRequest?.path).toBe("/api/gossip/shuffle");
      expect(lastRequest?.body).toEqual(JSON.parse(JSON.stringify(request)));
      expect(result.offered).toHaveLength(1);
      expect(result.offered[0]?.peerId).toBe("new-peer");
    });
  });

  // -----------------------------------------------------------------------
  // PeerUnreachableError on network failure
  // -----------------------------------------------------------------------

  describe("PeerUnreachableError on network failure", () => {
    it("throws PeerUnreachableError when peer is unreachable (bad port)", async () => {
      const transport = new HttpGossipTransport({ timeoutMs: 2000 });
      // Use a port that is almost certainly not listening
      const peer = makePeer("dead-peer", "http://127.0.0.1:1");

      await expect(transport.exchange(peer, makeGossipMessage("self"))).rejects.toThrow(
        PeerUnreachableError,
      );
    });

    it("throws PeerUnreachableError on HTTP error status", async () => {
      const transport = new HttpGossipTransport();
      const peer = makePeer("error-peer", baseUrl);

      serverResponseCode = 500;
      serverResponseBody = { error: "internal server error" };

      await expect(transport.exchange(peer, makeGossipMessage("self"))).rejects.toThrow(
        PeerUnreachableError,
      );
    });

    it("PeerUnreachableError carries peerId and address", async () => {
      const transport = new HttpGossipTransport();
      const peer = makePeer("err-peer", baseUrl);

      serverResponseCode = 503;

      try {
        await transport.exchange(peer, makeGossipMessage("self"));
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PeerUnreachableError);
        const pue = err as PeerUnreachableError;
        expect(pue.peerId).toBe("err-peer");
        expect(pue.address).toContain("/api/gossip/exchange");
      }
    });

    it("throws PeerUnreachableError for shuffle on HTTP error", async () => {
      const transport = new HttpGossipTransport();
      const peer = makePeer("bad-shuffle-peer", baseUrl);

      serverResponseCode = 502;

      const request: ShuffleRequest = {
        sender: makePeer("self", "http://self:4515"),
        offered: [],
      };

      await expect(transport.shuffle(peer, request)).rejects.toThrow(PeerUnreachableError);
    });
  });

  // -----------------------------------------------------------------------
  // GossipTimeoutError on timeout
  // -----------------------------------------------------------------------

  describe("GossipTimeoutError on timeout", () => {
    it("throws GossipTimeoutError when request exceeds timeout", async () => {
      const transport = new HttpGossipTransport({ timeoutMs: 100 });
      const peer = makePeer("slow-peer", baseUrl);

      serverDelayMs = 500;

      await expect(transport.exchange(peer, makeGossipMessage("self"))).rejects.toThrow(
        GossipTimeoutError,
      );
    });

    it("GossipTimeoutError carries peerId and timeoutMs", async () => {
      const transport = new HttpGossipTransport({ timeoutMs: 50 });
      const peer = makePeer("timeout-peer", baseUrl);

      serverDelayMs = 300;

      try {
        await transport.exchange(peer, makeGossipMessage("self"));
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GossipTimeoutError);
        const gte = err as GossipTimeoutError;
        expect(gte.peerId).toBe("timeout-peer");
        expect(gte.timeoutMs).toBe(50);
      }
    });

    it("throws GossipTimeoutError for shuffle on timeout", async () => {
      const transport = new HttpGossipTransport({ timeoutMs: 50 });
      const peer = makePeer("slow-shuffle", baseUrl);

      serverDelayMs = 300;

      const request: ShuffleRequest = {
        sender: makePeer("self", "http://self:4515"),
        offered: [],
      };

      await expect(transport.shuffle(peer, request)).rejects.toThrow(GossipTimeoutError);
    });
  });

  // -----------------------------------------------------------------------
  // Default config
  // -----------------------------------------------------------------------

  describe("default config", () => {
    it("uses default timeout when no config provided", async () => {
      const transport = new HttpGossipTransport();
      const peer = makePeer("default-peer", baseUrl);

      serverResponseBody = makeGossipMessage("default-peer");

      // Should succeed with default 10s timeout
      const result = await transport.exchange(peer, makeGossipMessage("self"));
      expect(result.peerId).toBe("default-peer");
    });
  });
});
