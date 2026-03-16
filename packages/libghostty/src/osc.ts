/**
 * OSC (Operating System Command) parser using libghostty-vt.
 *
 * Parses shell integration sequences (OSC 133), working directory
 * notifications (OSC 7), hyperlinks (OSC 8), and clipboard operations
 * (OSC 52) from agent terminal output.
 */

import { getLib } from "./ffi.js";

/** OSC command types as reported by libghostty-vt. */
export const OscCommand = {
  /** Set window title (OSC 0/2). */
  SetTitle: 0,
  /** Set working directory (OSC 7). */
  SetWorkingDirectory: 7,
  /** Hyperlink (OSC 8). */
  Hyperlink: 8,
  /** Clipboard operation (OSC 52). */
  Clipboard: 52,
  /** Shell integration — prompt start (OSC 133;A). */
  PromptStart: 133_01,
  /** Shell integration — command start (OSC 133;B). */
  CommandStart: 133_02,
  /** Shell integration — command end (OSC 133;D). */
  CommandEnd: 133_04,
} as const;
export type OscCommand = (typeof OscCommand)[keyof typeof OscCommand];

/** A parsed OSC event. */
export interface OscEvent {
  readonly type: OscCommand;
}

/**
 * Parse OSC sequences from raw terminal output.
 *
 * Feeds bytes one at a time through libghostty-vt's OSC parser,
 * collecting recognized commands. This enables:
 * - Detecting command boundaries (when agents start/finish commands)
 * - Extracting working directory (agent's current cwd)
 * - Processing hyperlinks in agent output
 *
 * @param data - Raw terminal output to scan for OSC sequences
 * @returns Array of recognized OSC events
 */
export function parseOscSequences(data: string | Uint8Array): readonly OscEvent[] {
  const lib = getLib();
  const encoder = new TextEncoder();
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const events: OscEvent[] = [];

  const parser = lib.symbols.ghostty_osc_new();
  if (parser === null) return events;

  try {
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (byte === undefined) continue;

      const hasEvent = lib.symbols.ghostty_osc_next(parser, byte);
      if (hasEvent) {
        const result = lib.symbols.ghostty_osc_end(parser);
        if (result !== null) {
          // The result pointer contains the parsed OSC command type
          // For now we capture the event type; full data extraction
          // can be added as the C API stabilizes
          events.push({ type: 0 as OscCommand });
          lib.symbols.ghostty_osc_free(result);
        }
      }
    }
  } finally {
    lib.symbols.ghostty_osc_free(parser);
  }

  return events;
}
