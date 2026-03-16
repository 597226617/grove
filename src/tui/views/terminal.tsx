/**
 * Terminal view — shows captured output from the selected agent's tmux session.
 *
 * Uses @xterm/headless for full VT emulation (colors, cursor, SGR, scrolling
 * regions) in pure JS — no native dependencies. Each agent gets a persistent
 * Terminal instance that maintains state across .write() calls, so only new
 * bytes are fed on each poll cycle.
 *
 * The rendered output preserves ANSI colors: each cell's foreground color is
 * read from the xterm buffer and applied via OpenTUI's <text color> prop.
 *
 * Falls back to plain text when xterm headless is not available.
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

const agentTerminals = new Map<string, PersistentTerminal>();

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

function feedTerminal(pt: PersistentTerminal, rawOutput: string): void {
  if (rawOutput.length > pt.prevLength && rawOutput.startsWith(pt.prevContent)) {
    const delta = rawOutput.slice(pt.prevLength);
    pt.terminal.write(delta);
  } else if (rawOutput !== pt.prevContent) {
    pt.terminal.reset();
    pt.terminal.write(rawOutput);
  }
  pt.prevLength = rawOutput.length;
  pt.prevContent = rawOutput;
}

// ---------------------------------------------------------------------------
// Styled line extraction from xterm buffer
// ---------------------------------------------------------------------------

/** A run of characters sharing the same foreground color. */
interface StyledSpan {
  text: string;
  color: string | undefined; // hex color or undefined for default
  bold: boolean;
}

/** A line of styled spans extracted from the xterm buffer. */
interface StyledLine {
  spans: StyledSpan[];
}

/** ANSI 16-color palette mapped to hex. */
const ANSI_COLORS: readonly string[] = [
  "#000000",
  "#cc0000",
  "#00cc00",
  "#cccc00",
  "#0088cc",
  "#cc00cc",
  "#00cccc",
  "#cccccc",
  "#555555",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#0088ff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
];

/** Convert an xterm color number to a hex string. */
function cellColorToHex(
  color: number,
  isRgb: boolean,
  r: number,
  g: number,
  b: number,
): string | undefined {
  if (isRgb) {
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }
  // Indexed color (0-255)
  if (color >= 0 && color < 16) {
    return ANSI_COLORS[color];
  }
  if (color >= 16 && color < 232) {
    // 216-color cube
    const idx = color - 16;
    const cr = Math.floor(idx / 36) * 51;
    const cg = Math.floor((idx % 36) / 6) * 51;
    const cb = (idx % 6) * 51;
    return `#${cr.toString(16).padStart(2, "0")}${cg.toString(16).padStart(2, "0")}${cb.toString(16).padStart(2, "0")}`;
  }
  if (color >= 232 && color < 256) {
    // Grayscale ramp
    const v = (color - 232) * 10 + 8;
    return `#${v.toString(16).padStart(2, "0")}${v.toString(16).padStart(2, "0")}${v.toString(16).padStart(2, "0")}`;
  }
  return undefined; // default terminal color
}

/** Extract styled lines from an xterm terminal buffer. */
function extractStyledLines(terminal: import("@xterm/headless").Terminal): StyledLine[] {
  const buf = terminal.buffer.active;
  const lines: StyledLine[] = [];
  const cell = terminal.buffer.active.getNullCell();

  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!line) continue;

    const spans: StyledSpan[] = [];
    let currentText = "";
    let currentColor: string | undefined;
    let currentBold = false;

    for (let x = 0; x < line.length; x++) {
      line.getCell(x, cell);
      if (!cell) continue;

      const char = cell.getChars();
      const fg = cell.getFgColor();
      const isFgRgb = cell.isFgRGB();
      const fgColor =
        fg === 0 && !isFgRgb
          ? undefined
          : cellColorToHex(fg, isFgRgb, (fg >> 16) & 0xff, (fg >> 8) & 0xff, fg & 0xff);
      const bold = cell.isBold() !== 0;

      if (fgColor !== currentColor || bold !== currentBold) {
        if (currentText) {
          spans.push({ text: currentText, color: currentColor, bold: currentBold });
        }
        currentText = char;
        currentColor = fgColor;
        currentBold = bold;
      } else {
        currentText += char;
      }
    }

    if (currentText) {
      spans.push({ text: currentText, color: currentColor, bold: currentBold });
    }

    lines.push({ spans });
  }

  // Trim trailing empty lines
  while (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (!last || last.spans.every((s) => s.text.trim() === "")) {
      lines.pop();
    } else {
      break;
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TerminalProps {
  readonly sessionName?: string | undefined;
  readonly tmux?: TmuxManager | undefined;
  readonly intervalMs: number;
  readonly active: boolean;
  readonly mode: InputMode;
}

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

    // Feed output and extract styled lines
    const styledLines = useMemo((): StyledLine[] | null => {
      const rawOutput = output ?? "";
      if (!rawOutput || !xtermReady || !xtermModule || !sessionName) return null;

      const pt = getAgentTerminal(sessionName, xtermModule);
      feedTerminal(pt, rawOutput);
      return extractStyledLines(pt.terminal);
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

    // Styled rendering via xterm buffer
    if (styledLines && styledLines.length > 0) {
      const displayLines = styledLines.slice(-30);
      return (
        <box flexDirection="column">
          {header}
          <box flexDirection="column">
            {displayLines.map((line, y) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: terminal lines have no stable identity
              <box key={y}>
                {line.spans.map((span, x) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: spans have no stable identity
                  <text key={x} color={span.color} bold={span.bold}>
                    {span.text}
                  </text>
                ))}
              </box>
            ))}
          </box>
        </box>
      );
    }

    // Plain text fallback
    const rawOutput = (output ?? "").trimEnd();
    const lines = rawOutput ? rawOutput.split("\n").slice(-30) : [];

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
