/**
 * Paste safety validation for terminal input.
 *
 * Detects potentially dangerous content before sending to agent terminals:
 * - Bracketed paste escape sequences
 * - OSC sequence injections
 * - Carriage returns (could overwrite prompt)
 */

/** ESC character (0x1b). */
const ESC = "\x1b";

/** Dangerous byte sequences that indicate terminal injection. */
const DANGEROUS_SEQUENCES: readonly string[] = [
  `${ESC}[200~`, // Bracketed paste start
  `${ESC}[201~`, // Bracketed paste end
  `${ESC}]`, // OSC sequence start
  "\r", // Carriage return (could overwrite prompt)
];

/**
 * Check if a string is safe to paste into a terminal.
 *
 * Returns true if safe, false if potentially dangerous.
 * Single keystrokes (length 1) are always safe.
 */
export function isPasteSafe(input: string): boolean {
  // Single characters are always safe (normal typing)
  if (input.length <= 1) return true;

  for (const seq of DANGEROUS_SEQUENCES) {
    if (input.includes(seq)) return false;
  }

  return true;
}
