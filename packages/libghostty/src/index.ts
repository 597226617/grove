/**
 * @grove/libghostty — Bun FFI bindings to libghostty-vt.
 *
 * Provides terminal emulation, VT-aware text extraction, HTML rendering,
 * OSC parsing, and paste safety validation via Ghostty's Zig terminal
 * emulation library.
 *
 * The libghostty-vt C API is unstable. This package pins to a specific
 * Ghostty commit and updates deliberately. See build.zig.zon for the
 * pinned version.
 *
 * @example
 * ```ts
 * import { GhosttyTerminal, ptyToText, isPasteSafe, isAvailable } from "@grove/libghostty";
 *
 * if (isAvailable()) {
 *   const term = new GhosttyTerminal(120, 30);
 *   term.write(rawPtyOutput);
 *   console.log(term.getText());
 *   term.destroy();
 * }
 * ```
 */

export { isAvailable } from "./ffi.js";
export { GhosttyTerminal, FormatterMode } from "./terminal.js";
export type { FormatterMode as FormatterModeType } from "./terminal.js";
export { ptyToText, ptyToHtml } from "./text.js";
export { isPasteSafe } from "./paste.js";
export { parseOscSequences, OscCommand } from "./osc.js";
export type { OscEvent } from "./osc.js";
