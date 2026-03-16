/**
 * Paste safety validation using libghostty-vt.
 *
 * Detects potentially dangerous content before sending to agent terminals:
 * - Injected newlines (could execute unintended commands)
 * - Bracketed paste escape sequences
 * - Terminal injection attacks
 */

import { getLib, ptr } from "./ffi.js";

/**
 * Check if a string is safe to paste into a terminal.
 *
 * Uses libghostty-vt's paste safety checker which detects injected
 * control sequences, newlines, and other terminal injection vectors.
 *
 * @param input - The text to validate before pasting
 * @returns true if safe, false if potentially dangerous
 */
export function isPasteSafe(input: string): boolean {
  const lib = getLib();
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  if (bytes.length === 0) return true;
  return lib.symbols.ghostty_paste_is_safe(ptr(bytes), bytes.length) as boolean;
}
