/**
 * Terminal view — shows captured output from the selected agent's tmux session.
 *
 * Uses @xterm/headless for full VT emulation (colors, cursor, SGR, scrolling
 * regions) in pure JS — no native dependencies. Each agent gets a persistent
 * Terminal instance that maintains state across .write() calls, so only new
 * bytes are fed on each poll cycle.
 *
 * Falls back to plain text when xterm headless is not available.
 *
 * In terminal input mode (press 'i' when Terminal panel focused),
 * keystrokes are forwarded to the tmux session via sendKeys.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { TmuxManager } from "../agents/tmux-manager.js";
import type { InputMode } from "../hooks/use-panel-focus.js";
import { usePolledData } from "../hooks/use-polled-data.js";
import { theme } from "../theme.js";

// ---------------------------------------------------------------------------
// Persistent terminal state per agent via @xterm/headless
// ---------------------------------------------------------------------------

interface PersistentTerminal {
  terminal: import("@xterm/headless").Terminal;
  prevLength: number;
  prevContent: string;
}

/** Map of session name → persistent terminal instance. */
const agentTerminals = new Map<string, PersistentTerminal>();

/** Lazy-loaded xterm module. */
let xtermModule: typeof import("@xterm/headless") | null = null;
let xtermLoadFailed = false;

async function getXterm(): Promise<typeof import("@xterm/headless") | null> {
  if (xtermModule) return xtermModule;
  if (xtermLoadFailed) return null;
  try {
    xtermModule = await import("@xterm/headless");
    return xtermModule;
  } catch {
    xtermLoadFailed = true;
    return null;
  }
}

/**
 * Get or create a persistent terminal for an agent session.
 * Returns null if @xterm/headless is not available.
 */
function getAgentTerminal(
  sessionName: string,
  xterm: typeof import("@xterm/headless"),
): PersistentTerminal {
  let pt = agentTerminals.get(sessionName);
  if (!pt) {
    pt = {
      terminal: new xterm.Terminal({ cols: 120, rows: 30, scrollback: 1000 }),
      prevLength: 0,
      prevContent: "",
    };
    agentTerminals.set(sessionName, pt);
  }
  return pt;
}

/**
 * Feed output to a persistent terminal, using delta detection.
 * If output grew with the same prefix, only feed the new bytes.
 * If output shrank or diverged (screen clear), reset and re-feed.
 */
function feedTerminal(pt: PersistentTerminal, rawOutput: string): void {
  if (rawOutput.length > pt.prevLength && rawOutput.startsWith(pt.prevContent)) {
    // Output grew with same prefix — feed only delta
    const delta = rawOutput.slice(pt.prevLength);
    pt.terminal.write(delta);
  } else if (rawOutput !== pt.prevContent) {
    // Output changed (screen clear, scroll, etc.) — full re-feed
    pt.terminal.reset();
    pt.terminal.write(rawOutput);
  }
  // else: identical output, no-op
  pt.prevLength = rawOutput.length;
  pt.prevContent = rawOutput;
}

/** Extract visible text from a terminal buffer. */
function extractText(terminal: import("@xterm/headless").Terminal): string {
  const buf = terminal.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }
  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
    lines.pop();
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Props for the Terminal view. */
export interface TerminalProps {
  /** The tmux session name to display. */
  readonly sessionName?: string | undefined;
  /** TmuxManager for pane capture. */
  readonly tmux?: TmuxManager | undefined;
  /** Polling interval for capture refresh. */
  readonly intervalMs: number;
  /** Whether this view is actively polling. */
  readonly active: boolean;
  /** Current input mode. */
  readonly mode: InputMode;
}

/** Terminal output view. */
export const TerminalView: React.NamedExoticComponent<TerminalProps> = React.memo(
  function TerminalView({
    sessionName,
    tmux,
    intervalMs,
    active,
    mode,
  }: TerminalProps): React.ReactNode {
    const captureMs = Math.max(intervalMs, 200);
    const [xtermReady, setXtermReady] = useState(xtermModule !== null);

    // Load xterm lazily on mount
    useEffect(() => {
      if (xtermModule) {
        setXtermReady(true);
        return;
      }
      let cancelled = false;
      getXterm().then((mod) => {
        if (!cancelled && mod) setXtermReady(true);
      });
      return () => {
        cancelled = true;
      };
    }, []);

    // Reset terminal when session changes
    useEffect(() => {
      if (sessionName) {
        const pt = agentTerminals.get(sessionName);
        if (pt) {
          pt.terminal.reset();
          pt.prevLength = 0;
          pt.prevContent = "";
        }
      }
    }, [sessionName]);

    const fetcher = useCallback(async () => {
      if (!tmux || !sessionName) return "";
      return tmux.capturePanes(sessionName);
    }, [tmux, sessionName]);

    const { data: output } = usePolledData<string>(
      fetcher,
      captureMs,
      active && !!sessionName && !!tmux,
    );

    // Feed output to persistent terminal and extract rendered text
    const renderedText = useMemo(() => {
      const rawOutput = output ?? "";
      if (!rawOutput || !xtermReady || !xtermModule || !sessionName) return null;

      const pt = getAgentTerminal(sessionName, xtermModule);
      feedTerminal(pt, rawOutput);
      return extractText(pt.terminal);
    }, [output, xtermReady, sessionName]);

    if (!tmux) {
      return (
        <box>
          <text opacity={0.5}>Terminal requires tmux — not available</text>
        </box>
      );
    }

    if (!sessionName) {
      return (
        <box flexDirection="column">
          <text opacity={0.5}>Select an agent (panel 5) to view terminal output</text>
          <text opacity={0.5}>Press i to enter input mode, Esc to exit</text>
        </box>
      );
    }

    const isInputMode = mode === "terminal_input";

    const header = (
      <box>
        <text color={theme.muted}>
          session: {sessionName}
          {isInputMode ? (
            <text color={theme.focus}> [INPUT]</text>
          ) : (
            <text opacity={0.5}> (press i to type)</text>
          )}
        </text>
      </box>
    );

    // Use xterm-rendered text if available, otherwise plain text fallback
    const displayText = renderedText ?? (output ?? "").trimEnd();
    const lines = displayText ? displayText.split("\n").slice(-30) : [];

    return (
      <box flexDirection="column">
        {header}
        {lines.length > 0 ? (
          <box flexDirection="column">
            {lines.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: terminal lines have no stable identity
              <text key={i}>{line}</text>
            ))}
          </box>
        ) : (
          <text opacity={0.5}>(no output)</text>
        )}
      </box>
    );
  },
);
