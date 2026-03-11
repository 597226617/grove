/**
 * Command palette overlay for the TUI.
 *
 * Activated via Ctrl+P, displays available commands.
 * Currently read-only; text-input filtering is planned for a follow-up.
 */

import React from "react";
import type { TmuxManager } from "../agents/tmux-manager.js";

/** Props for the CommandPalette component. */
export interface CommandPaletteProps {
  readonly visible: boolean;
  readonly tmux?: TmuxManager | undefined;
  readonly onClose: () => void;
  readonly onSpawn?: ((agentId: string, command: string, target: string) => void) | undefined;
  readonly onKill?: ((sessionName: string) => void) | undefined;
}

/** Available command descriptors. */
interface CommandEntry {
  readonly label: string;
  readonly description: string;
  readonly requiresTmux: boolean;
}

/** Static list of available commands. */
const COMMANDS: readonly CommandEntry[] = [
  {
    label: "/spawn <command> --target <ref>",
    description: "Spawn agent (local only, requires tmux)",
    requiresTmux: true,
  },
  {
    label: "/kill <session>",
    description: "Kill agent session",
    requiresTmux: true,
  },
  {
    label: "/refresh",
    description: "Force refresh all panels",
    requiresTmux: false,
  },
  {
    label: "/quit",
    description: "Quit TUI",
    requiresTmux: false,
  },
];

/** Ctrl+P command palette overlay showing available commands. */
export const CommandPalette: React.NamedExoticComponent<CommandPaletteProps> = React.memo(
  function CommandPalette({
    visible,
    tmux,
    onClose: _onClose,
  }: CommandPaletteProps): React.ReactNode {
    if (!visible) {
      return null;
    }

    const hasTmux = tmux !== undefined;

    return (
      <box flexDirection="column" paddingLeft={1} paddingRight={1}>
        <box>
          <text color="#00cccc">Command Palette (Esc to close)</text>
        </box>
        <box flexDirection="column" paddingLeft={1}>
          {COMMANDS.map((cmd) => {
            const dimmed = cmd.requiresTmux && !hasTmux;
            return (
              <box key={cmd.label}>
                <text color={dimmed ? "#555555" : "#ffffff"}>{cmd.label}</text>
                <text color={dimmed ? "#444444" : "#888888"}> — {cmd.description}</text>
                {dimmed && <text color="#555555"> (unavailable)</text>}
              </box>
            );
          })}
        </box>
      </box>
    );
  },
);
