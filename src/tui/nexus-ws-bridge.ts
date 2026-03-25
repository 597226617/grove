/**
 * Nexus SSE bridge — real-time push via Nexus Server-Sent Events.
 *
 * Connects to GET /api/v2/events/stream with path_pattern filter on
 * contribution paths. When a new contribution is written, reads it,
 * resolves topology edges, and pushes to target agent via runtime.send().
 *
 * No polling. Pure push from Nexus.
 */

import type { AgentRuntime, AgentSession } from "../core/agent-runtime.js";
import type { AgentTopology } from "../core/topology.js";

export interface NexusWsBridgeOptions {
  topology: AgentTopology;
  runtime: AgentRuntime;
  nexusUrl: string;
  apiKey: string;
}

interface SseEvent {
  type: string;
  path: string;
  zone_id: string;
}

export class NexusWsBridge {
  private readonly opts: NexusWsBridgeOptions;
  private readonly sessions = new Map<string, AgentSession>();
  private abortController: AbortController | null = null;
  private closed = false;

  constructor(opts: NexusWsBridgeOptions) {
    this.opts = opts;
  }

  registerSession(role: string, session: AgentSession): void {
    this.sessions.set(role, session);
  }

  unregisterSession(role: string): void {
    this.sessions.delete(role);
  }

  /** Connect to Nexus SSE stream and start listening for contribution events. */
  connect(): void {
    if (this.closed) return;
    void this.startSseLoop();
  }

  close(): void {
    this.closed = true;
    this.abortController?.abort();
    this.sessions.clear();
  }

  private async startSseLoop(): Promise<void> {
    while (!this.closed) {
      try {
        await this.connectSse();
      } catch {
        // Reconnect after delay
      }
      if (!this.closed) {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private async connectSse(): Promise<void> {
    this.abortController = new AbortController();
    const url = `${this.opts.nexusUrl}/api/v2/events/stream?event_types=write&path_pattern=/agents/*/inbox/*`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        Accept: "text/event-stream",
      },
      signal: this.abortController.signal,
    });

    if (!resp.ok || !resp.body) return;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!this.closed) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let eventData: string | null = null;
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          eventData = line.slice(6);
        } else if (line === "" && eventData) {
          this.handleEvent(eventData);
          eventData = null;
        }
      }
    }
  }

  private handleEvent(raw: string): void {
    try {
      const event = JSON.parse(raw) as SseEvent;
      if (event.type !== "write") return;

      // Extract role from path: /agents/{role}/inbox/...
      const match = event.path.match(/^\/agents\/([^/]+)\/inbox\//);
      if (!match) return;

      const targetRole = match[1] ?? "";
      const session = this.sessions.get(targetRole);
      if (!session || !targetRole) return;

      // Read the message content and push to agent
      void this.readAndPush(event.path, targetRole, session);
    } catch {
      // Skip malformed events
    }
  }

  private async readAndPush(
    path: string,
    targetRole: string,
    session: AgentSession,
  ): Promise<void> {
    try {
      // Read the inbox message via VFS
      const resp = await fetch(`${this.opts.nexusUrl}/api/nfs/sys_read`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "sys_read",
          params: { path },
          id: 1,
        }),
      });
      if (!resp.ok) return;

      const result = (await resp.json()) as {
        result?: { data?: string };
      };
      if (!result.result?.data) return;

      // Decode message (base64 encoded)
      const raw = Buffer.from(result.result.data, "base64").toString();
      const msg = JSON.parse(raw) as {
        sender?: string;
        payload?: Record<string, unknown>;
      };

      const sender = msg.sender ?? "system";
      const summary =
        (msg.payload?.summary as string) ?? JSON.stringify(msg.payload ?? {}).slice(0, 100);
      const notification = `[Nexus IPC] ${sender}: ${summary}`;

      process.stderr.write(
        `[NexusWsBridge] pushing to ${targetRole}: ${notification.slice(0, 80)}\n`,
      );
      void this.opts.runtime.send(session, notification).catch(() => {
        /* non-fatal */
      });
    } catch {
      // Non-fatal
    }
  }
}
