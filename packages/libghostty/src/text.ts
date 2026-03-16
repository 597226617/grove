/**
 * VT-aware text extraction utilities.
 *
 * Provides ptyToText() — a drop-in replacement for ghostty-opentui's
 * ptyToText() that uses the native terminal emulator for correct ANSI
 * stripping instead of regex heuristics.
 */

import { GhosttyTerminal, FormatterMode } from "./terminal.js";

/**
 * Convert raw PTY output to plain text using proper VT emulation.
 *
 * This correctly handles cursor movements, scrolling regions, multi-byte
 * sequences, and reflow — unlike regex-based stripping which breaks on
 * anything beyond simple SGR sequences.
 *
 * @param input - Raw PTY bytes (string or Buffer/Uint8Array)
 * @param options - Terminal dimensions for emulation
 * @returns Clean plain text with escape sequences properly interpreted
 */
export function ptyToText(
  input: string | Buffer | Uint8Array,
  options?: { cols?: number; rows?: number },
): string {
  const cols = options?.cols ?? 120;
  const rows = options?.rows ?? 30;

  const terminal = new GhosttyTerminal(cols, rows, 0);
  try {
    terminal.write(input instanceof Buffer ? new Uint8Array(input) : input);
    return terminal.getText();
  } finally {
    terminal.destroy();
  }
}

/**
 * Convert raw PTY output to styled HTML using proper VT emulation.
 *
 * @param input - Raw PTY bytes (string or Buffer/Uint8Array)
 * @param options - Terminal dimensions for emulation
 * @returns HTML with inline styles for colors, bold, italic, etc.
 */
export function ptyToHtml(
  input: string | Buffer | Uint8Array,
  options?: { cols?: number; rows?: number },
): string {
  const cols = options?.cols ?? 120;
  const rows = options?.rows ?? 30;

  const terminal = new GhosttyTerminal(cols, rows, 0);
  try {
    terminal.write(input instanceof Buffer ? new Uint8Array(input) : input);
    return terminal.getHtml();
  } finally {
    terminal.destroy();
  }
}
