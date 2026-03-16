/**
 * Terminal view — shows captured output from the selected agent's tmux session.
 *
 * Uses @grove/libghostty for full ANSI/VT rendering when available. Falls
 * back to ghostty-opentui, then to plain text if neither native library
 * is loadable.
 *
 * The dynamic import is wrapped in a module-level promise so that:
 *  1. We only attempt the import once (not on every render).
 *  2. The fallback path has zero overhead — no per-frame try/catch.
 *
 * In terminal input mode (press 'i' when Terminal panel focused),
 * keystrokes are forwarded to the tmux session via sendKeys.
 */

import React, { createElement, useCallback, useEffect, useState } from "react";
import type { TmuxManager } from "../agents/tmux-manager.js";
import type { InputMode } from "../hooks/use-panel-focus.js";
import { usePolledData } from "../hooks/use-polled-data.js";
import { theme } from "../theme.js";

// ---------------------------------------------------------------------------
// Ghostty integration — try @grove/libghostty first, fall back to ghostty-opentui
// ---------------------------------------------------------------------------

let ghosttyRegistered = false;

/**
 * Try to load and register the terminal renderable.
 * Priority: @grove/libghostty → ghostty-opentui → plain text fallback.
 */
const ghosttyPromise: Promise<boolean> = (async () => {
  const opentui = (await import("@opentui/react").catch(() => null)) as {
    extend?: (objects: Record<string, unknown>) => void;
  } | null;
  if (!opentui?.extend) return false;

  // Try @grove/libghostty first (our own FFI bindings)
  try {
    const { GhosttyRenderable } = await import("@grove/libghostty/renderable");
    opentui.extend({ "ghostty-terminal": GhosttyRenderable as unknown });
    ghosttyRegistered = true;
    return true;
  } catch {
    // @grove/libghostty not available — try ghostty-opentui fallback
  }

  // Fallback: ghostty-opentui (third-party wrapper)
  try {
    const mod = (await import("ghostty-opentui/opentui")) as {
      GhosttyTerminalRenderable?: unknown;
    };
    if (mod.GhosttyTerminalRenderable) {
      opentui.extend({ "ghostty-terminal": mod.GhosttyTerminalRenderable });
      ghosttyRegistered = true;
      return true;
    }
  } catch {
    // Neither available — fall back to plain text
  }

  return false;
})();

/** Hook that resolves the ghostty module once and caches the result. */
function useGhosttyAvailable(): boolean {
  const [available, setAvailable] = useState(ghosttyRegistered);
  useEffect(() => {
    if (ghosttyRegistered) {
      setAvailable(true);
      return;
    }
    let cancelled = false;
    ghosttyPromise.then((ok) => {
      if (!cancelled && ok) {
        setAvailable(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
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
    const captureMs = Math.max(intervalMs, 200); // minimum 200ms for terminal
    const ghosttyAvailable = useGhosttyAvailable();

    const fetcher = useCallback(async () => {
      if (!tmux || !sessionName) return "";
      return tmux.capturePanes(sessionName);
    }, [tmux, sessionName]);

    const { data: output } = usePolledData<string>(
      fetcher,
      captureMs,
      active && !!sessionName && !!tmux,
    );

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
    const rawOutput = output ?? "";

    // Status header — shared by both rendering paths
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

    // --- Ghostty path: full ANSI/VT rendering ---
    if (ghosttyAvailable && rawOutput.length > 0) {
      return (
        <box flexDirection="column">
          {header}
          {/* createElement used because "ghostty-terminal" is a dynamically
              registered intrinsic element without static JSX type definitions. */}
          {createElement("ghostty-terminal" as string, {
            ansi: rawOutput,
            cols: 120,
            rows: 30,
            trimEnd: true,
          })}
        </box>
      );
    }

    // --- Fallback path: plain text line rendering ---
    const trimmedOutput = rawOutput.trimEnd();
    const lines = trimmedOutput ? trimmedOutput.split("\n").slice(-30) : [];

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
