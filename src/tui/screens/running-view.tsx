/**
 * Screen 4: Running view — contribution feed + agent status.
 *
 * Top: Agent status line (braille spinner for working, bullet for active, circle for idle, x for crashed)
 * Middle: Contribution feed (last 50, scrollable with j/k)
 * Bottom: Status bar with [RUNNING] label
 * Tab: toggle to advanced mode (existing App boardroom)
 * Ctrl+F: Nexus folder browser overlay
 * q: confirm quit
 */

import { useKeyboard } from "@opentui/react";
import React, { useCallback, useEffect, useState } from "react";
import type { Contribution } from "../../core/models.js";
import type { AgentTopology } from "../../core/topology.js";
import { usePolledData } from "../hooks/use-polled-data.js";
import type { DashboardData, TuiDataProvider } from "../provider.js";
import { isVfsProvider } from "../provider.js";
import { BRAILLE_SPINNER, PLATFORM_COLORS, theme } from "../theme.js";
import { VfsBrowserView } from "../views/vfs-browser.js";

/** Props for the RunningView screen. */
export interface RunningViewProps {
  readonly provider: TuiDataProvider;
  readonly intervalMs: number;
  readonly topology?: AgentTopology | undefined;
  readonly goal?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly onToggleAdvanced: () => void;
  readonly onComplete: (reason: string) => void;
  readonly onQuit: () => void;
}

/** Format a timestamp for display. */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "--:--";
  }
}

const MAX_FEED_ITEMS = 50;

/** Screen 4: running view with contribution feed and agent status. */
export const RunningView: React.NamedExoticComponent<RunningViewProps> = React.memo(
  function RunningView({
    provider,
    intervalMs,
    topology,
    goal,
    onToggleAdvanced,
    onComplete: _onComplete,
    onQuit,
  }: RunningViewProps): React.ReactNode {
    const [cursor, setCursor] = useState(0);
    const [showVfs, setShowVfs] = useState(false);
    const [confirmQuit, setConfirmQuit] = useState(false);
    const [spinnerFrame, setSpinnerFrame] = useState(0);

    // Braille spinner animation
    useEffect(() => {
      const timer = setInterval(() => {
        setSpinnerFrame((f) => (f + 1) % BRAILLE_SPINNER.length);
      }, 80);
      return () => clearInterval(timer);
    }, []);

    // Poll dashboard data
    const dashboardFetcher = useCallback(() => provider.getDashboard(), [provider]);
    const { data: dashboard } = usePolledData<DashboardData>(dashboardFetcher, intervalMs, true);

    // Poll recent contributions for the feed
    const contributionsFetcher = useCallback(
      () => provider.getContributions({ limit: MAX_FEED_ITEMS }),
      [provider],
    );
    const { data: contributions } = usePolledData<readonly Contribution[]>(
      contributionsFetcher,
      intervalMs,
      true,
    );

    const feed = contributions ?? [];

    useKeyboard(
      useCallback(
        (key) => {
          // Ctrl+F: toggle VFS browser
          if (key.ctrl && key.name === "f") {
            setShowVfs((v) => !v);
            return;
          }
          // Tab: toggle advanced mode
          if (key.name === "tab") {
            onToggleAdvanced();
            return;
          }
          // Escape: dismiss VFS or quit confirm
          if (key.name === "escape") {
            if (showVfs) {
              setShowVfs(false);
              return;
            }
            if (confirmQuit) {
              setConfirmQuit(false);
              return;
            }
            return;
          }
          // q: quit with confirmation
          if (key.name === "q") {
            if (showVfs) {
              setShowVfs(false);
              return;
            }
            if (confirmQuit) {
              onQuit();
              return;
            }
            setConfirmQuit(true);
            return;
          }
          // j/k: scroll feed
          if (key.name === "j" || key.name === "down") {
            setCursor((c) => Math.min(c + 1, Math.max(0, feed.length - 1)));
            return;
          }
          if (key.name === "k" || key.name === "up") {
            setCursor((c) => Math.max(c - 1, 0));
            return;
          }
        },
        [showVfs, confirmQuit, feed.length, onToggleAdvanced, onQuit],
      ),
    );

    // Agent status line
    const agentStatusLine = (topology?.roles ?? []).map((role) => {
      const activeClaim = dashboard?.activeClaims.find(
        (c) => c.agent.role === role.name || c.agent.agentId.startsWith(role.name),
      );
      const platformColor = PLATFORM_COLORS[role.platform ?? "claude-code"] ?? theme.text;

      let icon: string;
      let color: string;
      if (activeClaim) {
        icon = BRAILLE_SPINNER[spinnerFrame] ?? theme.agentRunning;
        color = theme.running;
      } else {
        icon = theme.agentIdle;
        color = theme.idle;
      }

      return (
        <box key={role.name} flexDirection="row" marginRight={2}>
          <text color={color}>{icon} </text>
          <text color={platformColor}>{role.name}</text>
        </box>
      );
    });

    // VFS overlay
    if (showVfs) {
      if (isVfsProvider(provider)) {
        return (
          <box
            flexDirection="column"
            width="100%"
            height="100%"
            borderStyle="round"
            borderColor={theme.focus}
          >
            <box flexDirection="row" paddingX={2} paddingTop={1}>
              <text color={theme.focus} bold>
                Nexus Folder Browser
              </text>
              <text color={theme.dimmed}> (Esc to close)</text>
            </box>
            <box flexDirection="column" paddingX={2} flexGrow={1}>
              <VfsBrowserView
                provider={provider}
                intervalMs={intervalMs}
                active={true}
                cursor={cursor}
                navigateTrigger={0}
              />
            </box>
          </box>
        );
      }
      // Fallback: show .grove/ directory hint
      return (
        <box
          flexDirection="column"
          width="100%"
          height="100%"
          borderStyle="round"
          borderColor={theme.focus}
        >
          <box flexDirection="column" paddingX={2} paddingTop={1}>
            <text color={theme.focus} bold>
              File Browser
            </text>
            <text color={theme.muted}>{""}</text>
            <text color={theme.text}>VFS requires Nexus backend.</text>
            <text color={theme.muted}>Browse .grove/ directory locally for session files.</text>
            <text color={theme.muted}>{""}</text>
            <text color={theme.dimmed}>Esc:close</text>
          </box>
        </box>
      );
    }

    const contribCount = dashboard?.metadata.contributionCount ?? 0;
    const claimCount = dashboard?.activeClaims.length ?? 0;

    return (
      <box flexDirection="column" width="100%" height="100%">
        {/* Agent status line */}
        <box flexDirection="row" paddingX={2} paddingTop={1}>
          <text color={theme.focus} bold>
            Agents{" "}
          </text>
          {agentStatusLine.length > 0 ? (
            agentStatusLine
          ) : (
            <text color={theme.dimmed}>No roles defined</text>
          )}
        </box>

        {/* Goal display */}
        {goal ? (
          <box paddingX={2}>
            <text color={theme.muted}>Goal: {goal}</text>
          </box>
        ) : null}

        {/* Contribution feed */}
        <box
          flexDirection="column"
          marginX={2}
          marginTop={1}
          borderStyle="single"
          borderColor={theme.border}
          paddingX={1}
          flexGrow={1}
        >
          <text color={theme.focus} bold>
            Contribution Feed
          </text>
          {feed.length === 0 ? (
            <text color={theme.dimmed}>Waiting for contributions...</text>
          ) : (
            feed.slice(Math.max(0, cursor - 20), cursor + 30).map((c, i) => {
              const actualIndex = Math.max(0, cursor - 20) + i;
              const selected = actualIndex === cursor;
              const kindColor =
                c.kind === "work"
                  ? theme.work
                  : c.kind === "review"
                    ? theme.review
                    : c.kind === "discussion"
                      ? theme.discussion
                      : c.kind === "adoption"
                        ? theme.adoption
                        : theme.text;
              return (
                <box
                  key={c.cid}
                  flexDirection="row"
                  backgroundColor={selected ? theme.selectedBg : undefined}
                >
                  <text color={theme.dimmed}>{formatTime(c.createdAt)} </text>
                  <text color={kindColor}>{c.kind.padEnd(12)}</text>
                  <text color={selected ? theme.text : theme.muted}>{c.summary.slice(0, 60)}</text>
                </box>
              );
            })
          )}
        </box>

        {/* Quit confirmation */}
        {confirmQuit ? (
          <box paddingX={2}>
            <text color={theme.warning}>Press q again to quit, Esc to cancel</text>
          </box>
        ) : null}

        {/* Status bar */}
        <box flexDirection="row" paddingX={2}>
          <text color={theme.running}>[RUNNING]</text>
          <text color={theme.muted}>
            {" "}
            {contribCount}c | {claimCount} active
          </text>
          <text color={theme.dimmed}> Tab:advanced Ctrl+F:browser j/k:scroll q:quit</text>
        </box>
      </box>
    );
  },
);
