/**
 * Welcome screen view — shown when grove is launched without initialization.
 *
 * Displays a welcome banner, available presets, a concept glossary,
 * and keyboard hints for navigation.
 */

import React, { useState, useCallback } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { theme } from "../theme.js";

/** A preset entry for the welcome screen. */
export interface PresetEntry {
  readonly name: string;
  readonly description: string;
  /** Extended details for the ? overlay (mode, backend, topology summary). */
  readonly details?: string | undefined;
}

/** Props for the WelcomeScreen component. */
export interface WelcomeProps {
  readonly presets: readonly PresetEntry[];
  readonly onSelect: (presetName: string) => void;
  readonly onQuit: () => void;
}

/** Concept glossary entries displayed on the welcome screen. */
const GLOSSARY: readonly { term: string; definition: string }[] = [
  { term: "Contribution", definition: "Immutable snapshot of work" },
  { term: "DAG", definition: "Dependency graph of contributions" },
  { term: "Frontier", definition: "Latest contributions per metric" },
  { term: "Claim", definition: "Lock preventing duplicate work" },
  { term: "Topology", definition: "Agent roles and spawn rules" },
  { term: "Preset", definition: "Pre-configured grove template" },
];

/** Welcome screen shown when no .grove/ directory exists. */
export const WelcomeScreen: React.NamedExoticComponent<WelcomeProps> = React.memo(
  function WelcomeScreen({ presets, onSelect, onQuit }: WelcomeProps): React.ReactNode {
    const [cursor, setCursor] = useState(0);
    const [showDetail, setShowDetail] = useState(false);
    void useRenderer();

    useKeyboard(
      useCallback(
        (key) => {
          const input = key.name;

          if (input === "q") {
            onQuit();
            return;
          }

          if (input === "j" || input === "down") {
            setCursor((c) => Math.min(c + 1, presets.length - 1));
            return;
          }

          if (input === "k" || input === "up") {
            setCursor((c) => Math.max(c - 1, 0));
            return;
          }

          if (input === "return") {
            const selected = presets[cursor];
            if (selected) {
              onSelect(selected.name);
            }
            return;
          }

          if (input === "?" || (key.shift && input === "/")) {
            setShowDetail((v) => !v);
            return;
          }
        },
        [presets, cursor, onSelect, onQuit],
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
        {/* Banner */}
        <box flexDirection="column" paddingX={2} paddingTop={1}>
          <text color={theme.focus} bold>
            Welcome to Grove
          </text>
          <text color={theme.muted}>{""}</text>
          <text color={theme.text}>Grove is a multi-agent collaboration workspace.</text>
          <text color={theme.text}>Agents work together on a shared contribution graph</text>
          <text color={theme.text}>with human oversight.</text>
        </box>

        {/* Quick Start — Preset list */}
        <box
          flexDirection="column"
          marginX={2}
          marginTop={1}
          borderStyle="single"
          borderColor={theme.border}
          paddingX={1}
        >
          <text color={theme.focus} bold>
            Quick Start
          </text>
          {presets.map((preset, i) => {
            const selected = i === cursor;
            const prefix = selected ? "> " : "  ";
            return (
              <text
                key={preset.name}
                color={selected ? theme.focus : theme.text}
                backgroundColor={selected ? theme.selectedBg : undefined}
                bold={selected}
              >
                {prefix}
                {preset.name.padEnd(20)}
                <text color={theme.muted}>{preset.description}</text>
              </text>
            );
          })}
        </box>

        {/* Detail overlay for selected preset */}
        {showDetail && presets[cursor] ? (
          <box
            flexDirection="column"
            marginX={2}
            marginTop={1}
            borderStyle="single"
            borderColor={theme.info}
            paddingX={1}
          >
            <text color={theme.info} bold>
              Preset: {presets[cursor]?.name ?? ""}
            </text>
            <text color={theme.text}>{presets[cursor]?.description ?? ""}</text>
            {presets[cursor]?.details ? (
              <box flexDirection="column" marginTop={1}>
                {presets[cursor]!.details!.split("\n").map((line, i) => (
                  <text
                    // biome-ignore lint/suspicious/noArrayIndexKey: detail lines have no stable identity
                    key={i}
                    color={theme.muted}
                  >
                    {line}
                  </text>
                ))}
              </box>
            ) : null}
            <text color={theme.dimmed}>Press ? to close details</text>
          </box>
        ) : null}

        {/* Concept glossary */}
        <box
          flexDirection="column"
          marginX={2}
          marginTop={1}
          borderStyle="single"
          borderColor={theme.border}
          paddingX={1}
        >
          <text color={theme.focus} bold>
            What is this?
          </text>
          {GLOSSARY.map((entry) => (
            <text key={entry.term} color={theme.text}>
              {"  "}
              <text color={theme.info}>{entry.term.padEnd(16)}</text>
              <text color={theme.muted}>{entry.definition}</text>
            </text>
          ))}
        </box>

        {/* Keyboard hints */}
        <box paddingX={2} marginTop={1}>
          <text color={theme.dimmed}>j/k:navigate Enter:select ?:details q:quit</text>
        </box>
      </box>
    );
  },
);
