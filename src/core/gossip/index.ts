/**
 * Core gossip protocol types and errors.
 *
 * Re-exports all gossip protocol types for convenient imports.
 */

export { GossipTimeoutError, PeerUnreachableError } from "./errors.js";
export {
  type FrontierDigestEntry,
  type GossipConfig,
  type GossipEvent,
  type GossipEventListener,
  GossipEventType,
  type GossipEventType as GossipEventTypeValue,
  type GossipMessage,
  type GossipService,
  type GossipTransport,
  type PeerCapabilities,
  type PeerInfo,
  type PeerLiveness,
  type PeerLoad,
  PeerStatus,
  type PeerStatus as PeerStatusType,
  type ShuffleRequest,
  type ShuffleResponse,
} from "./types.js";
