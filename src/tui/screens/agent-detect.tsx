/**
 * Screen 2: Agent detection — auto-detect installed agent CLIs.
 *
 * Checks for claude, codex, gemini via `which`. Shows role mapping
 * from topology. Green dot for found, hollow circle for missing.
 * Enter continues (even with partial), Esc goes back.
 */

import { useKeyboard } from "@opentui/react";
import React, { useCallback, useEffect, useState } from "react";
import type { AgentTopology } from "../../core/topology.js";
import { PLATFORM_COLORS, theme } from "../theme.js";

/** Known CLI tools and their platform identifiers. */
const AGENT_CLIS: readonly { cli: string; platform: string; label: string }[] = [
  { cli: "claude", platform: "claude-code", label: "Claude Code" },
  { cli: "codex", platform: "codex", label: "Codex CLI" },
  { cli: "gemini", platform: "gemini", label: "Gemini CLI" },
];

/** Props for the AgentDetect screen. */
export interface AgentDetectProps {
  readonly topology?: AgentTopology | undefined;
  readonly onContinue: (detected: Map<string, boolean>, roleMapping: Map<string, string>) => void;
  readonly onBack: () => void;
}

/** Check if a CLI tool is installed via `which`. */
async function detectCli(name: string): Promise<boolean> {
  try {
    const { execSync } = await import("node:child_process");
    execSync(`which ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Screen 2: auto-detect agent CLIs and show role mapping. */
export const AgentDetect: React.NamedExoticComponent<AgentDetectProps> = React.memo(
  function AgentDetect({ topology, onContinue, onBack }: AgentDetectProps): React.ReactNode {
    const [detected, setDetected] = useState<Map<string, boolean>>(new Map());
    const [scanning, setScanning] = useState(true);

    // Auto-detect CLIs on mount
    useEffect(() => {
      void (async () => {
        const results = new Map<string, boolean>();
        for (const agent of AGENT_CLIS) {
          results.set(agent.cli, await detectCli(agent.cli));
        }
        setDetected(results);
        setScanning(false);
      })();
    }, []);

    // Build role-to-CLI mapping from topology
    const roleMapping = new Map<string, string>();
    if (topology) {
      for (const role of topology.roles) {
        const platform = role.platform ?? "claude-code";
        const cli = AGENT_CLIS.find((a) => a.platform === platform);
        if (cli) roleMapping.set(role.name, cli.cli);
      }
    }

    useKeyboard(
      useCallback(
        (key) => {
          if (key.name === "return" && !scanning) {
            onContinue(detected, roleMapping);
            return;
          }
          if (key.name === "escape") {
            onBack();
            return;
          }
        },
        [scanning, detected, roleMapping, onContinue, onBack],
      ),
    );

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
            Agent Detection
          </text>
          <text color={theme.muted}>
            {scanning ? "Scanning for installed agent CLIs..." : "Detection complete"}
          </text>
          <text color={theme.muted}>{""}</text>
        </box>

        {/* CLI detection results */}
        <box
          flexDirection="column"
          marginX={2}
          borderStyle="single"
          borderColor={theme.border}
          paddingX={1}
        >
          <text color={theme.text} bold>
            Installed CLIs
          </text>
          {AGENT_CLIS.map((agent) => {
            const found = detected.get(agent.cli);
            const icon = found ? theme.agentRunning : theme.agentIdle;
            const color = found ? theme.success : theme.dimmed;
            const platformColor = PLATFORM_COLORS[agent.platform] ?? theme.text;
            return (
              <box key={agent.cli} flexDirection="row">
                <text color={color}> {icon} </text>
                <text color={platformColor}>{agent.label.padEnd(16)}</text>
                <text color={theme.muted}>
                  {found ? "found" : scanning ? "scanning..." : "not found"}
                </text>
              </box>
            );
          })}
        </box>

        {/* Role mapping from topology */}
        {topology && topology.roles.length > 0 ? (
          <box
            flexDirection="column"
            marginX={2}
            marginTop={1}
            borderStyle="single"
            borderColor={theme.border}
            paddingX={1}
          >
            <text color={theme.text} bold>
              Role Mapping
            </text>
            {topology.roles.map((role) => {
              const cli = roleMapping.get(role.name) ?? "unknown";
              const cliFound = detected.get(cli) ?? false;
              const icon = cliFound ? theme.agentRunning : theme.agentIdle;
              const color = cliFound ? theme.success : theme.dimmed;
              return (
                <box key={role.name} flexDirection="row">
                  <text color={color}> {icon} </text>
                  <text color={theme.text}>{role.name.padEnd(16)}</text>
                  <text color={theme.muted}>{" -> "}</text>
                  <text color={cliFound ? theme.text : theme.dimmed}>{cli}</text>
                  {role.description ? (
                    <text color={theme.dimmed}> ({role.description})</text>
                  ) : null}
                </box>
              );
            })}
          </box>
        ) : null}

        {/* Keyboard hints */}
        <box paddingX={2} marginTop={1}>
          <text color={theme.dimmed}>
            {scanning ? "Scanning..." : "Enter:continue (even with partial) Esc:back"}
          </text>
        </box>
      </box>
    );
  },
);
