/**
 * Nexus-backed EventBus — uses Nexus VFS inboxes for cross-process IPC.
 *
 * When an event is published, it writes a message file to the target
 * agent's inbox at /agents/{agentId}/inbox/{timestamp}-{type}.json.
 *
 * Subscribers poll their inbox for new messages (with EventBus push
 * as optimization when available).
 *
 * This replaces LocalEventBus (in-process EventEmitter) for Nexus mode.
 */

import type { EventBus, EventHandler, GroveEvent } from "../core/event-bus.js";
import type { NexusClient } from "./client.js";

const AGENTS_ROOT = "/agents";

/** Nexus VFS-backed event bus for cross-process agent communication. */
export class NexusEventBus implements EventBus {
  private readonly client: NexusClient;

  private readonly handlers = new Map<string, EventHandler[]>();
  private pollers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(client: NexusClient, _zoneId: string) {
    this.client = client;
  }

  publish(event: GroveEvent): void {
    // Send via Nexus IPC API — triggers SSE push to subscribers
    const nexusUrl = (this.client as { baseUrl?: string }).baseUrl ?? process.env.GROVE_NEXUS_URL;
    const apiKey = process.env.NEXUS_API_KEY;

    if (nexusUrl && apiKey) {
      void fetch(`${nexusUrl}/api/v2/ipc/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          sender: event.sourceRole,
          recipient: event.targetRole,
          type: "event",
          payload: event.payload,
        }),
      }).catch(() => {
        /* best-effort */
      });
    }

    // Also write to VFS inbox as backup (triggers SSE via write observer)
    const inboxPath = `${AGENTS_ROOT}/${event.targetRole}/inbox/${Date.now()}-${event.type}.json`;
    const data = new TextEncoder().encode(JSON.stringify(event));
    void this.client.write(inboxPath, data).catch(() => {
      // Non-fatal — event delivery is best-effort
    });

    // Also notify local handlers (for in-process subscribers)
    const handlers = this.handlers.get(event.targetRole);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch {
          // Handler errors are non-fatal
        }
      }
    }
  }

  subscribe(role: string, handler: EventHandler): void {
    let handlers = this.handlers.get(role);
    if (!handlers) {
      handlers = [];
      this.handlers.set(role, handlers);
    }
    handlers.push(handler);

    // Start polling this role's inbox if not already
    if (!this.pollers.has(role)) {
      const poller = setInterval(() => {
        void this.pollInbox(role);
      }, 10000); // 10s to avoid Nexus rate limits
      this.pollers.set(role, poller);
    }
  }

  unsubscribe(role: string, handler: EventHandler): void {
    const handlers = this.handlers.get(role);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);

    if (handlers.length === 0) {
      this.handlers.delete(role);
      const poller = this.pollers.get(role);
      if (poller) {
        clearInterval(poller);
        this.pollers.delete(role);
      }
    }
  }

  close(): void {
    for (const poller of this.pollers.values()) {
      clearInterval(poller);
    }
    this.pollers.clear();
    this.handlers.clear();
  }

  /** Track processed message filenames to avoid reprocessing. */
  private processed = new Set<string>();

  /** Poll an agent's inbox for new messages. */
  private async pollInbox(role: string): Promise<void> {
    try {
      const inboxPath = `${AGENTS_ROOT}/${role}/inbox`;
      const result = await this.client.list(inboxPath);
      if (!result || result.files.length === 0) return;

      const handlers = this.handlers.get(role);
      if (!handlers || handlers.length === 0) return;

      for (const entry of result.files) {
        const filePath = entry.path || `${inboxPath}/${entry.name}`;
        if (this.processed.has(filePath)) continue;

        try {
          const data = await this.client.read(filePath);
          if (!data) continue;
          const event = JSON.parse(new TextDecoder().decode(data)) as GroveEvent;
          for (const handler of handlers) {
            handler(event);
          }
          this.processed.add(filePath);
        } catch {
          // Skip malformed messages
          this.processed.add(filePath);
        }
      }
    } catch {
      // Inbox may not exist yet — non-fatal
    }
  }
}
