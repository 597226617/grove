/**
 * Terminal view — shows captured output from the selected agent's tmux session.
 *
 * When ghostty-opentui is available, renders via PersistentTerminal for
 * full ANSI/VT support. Falls back to plain text capture otherwise.
 *
 * In terminal input mode (press 'i' when Terminal panel focused),
 * keystrokes are forwarded to the tmux session via sendKeys.
 */

import React, { useCallback } from "react";
import type { TmuxManager } from "../agents/tmux-manager.js";
import type { InputMode } from "../hooks/use-panel-focus.js";
import { usePolledData } from "../hooks/use-polled-data.js";

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
    const trimmedOutput = (output ?? "").trimEnd();
    const lines = trimmedOutput ? trimmedOutput.split("\n").slice(-30) : [];

    return (
      <box flexDirection="column">
        <box>
          <text color="#888888">
            session: {sessionName}
            {isInputMode ? (
              <text color="#00cccc"> [INPUT]</text>
            ) : (
              <text opacity={0.5}> (press i to type)</text>
            )}
          </text>
        </box>
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
