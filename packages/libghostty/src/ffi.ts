/**
 * Low-level FFI bindings to libghostty-vt via bun:ffi.
 *
 * Loads the platform-appropriate shared library (dylib/so) and exposes
 * raw function pointers. Higher-level wrappers in terminal.ts and
 * formatter.ts provide a safe, ergonomic TypeScript API.
 *
 * The libghostty-vt C API is unstable — we pin to a specific Ghostty
 * commit in build.zig.zon and update deliberately.
 */

import { dlopen, FFIType, ptr, toArrayBuffer, suffix as bunSuffix } from "bun:ffi";
import { join } from "node:path";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

function detectPlatformDir(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const os = process.platform === "darwin" ? "darwin" : "linux";
  return `${os}-${arch}`;
}

function findLibrary(): string {
  const platformDir = detectPlatformDir();
  const libName = `libghostty-vt.${bunSuffix}`;

  // 1. Check platforms/ directory relative to package root
  const packageRoot = new URL("../..", import.meta.url).pathname;
  const platformPath = join(packageRoot, "platforms", platformDir, libName);
  if (existsSync(platformPath)) return platformPath;

  // 2. Check LIBGHOSTTY_PATH env override
  const envPath = process.env.LIBGHOSTTY_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  // 3. Check system paths
  const systemPaths = [
    `/usr/local/lib/${libName}`,
    `/usr/lib/${libName}`,
    join(process.env.HOME ?? "", ".local", "lib", libName),
  ];
  for (const p of systemPaths) {
    if (existsSync(p)) return p;
  }

  throw new Error(
    `libghostty-vt not found for ${platformDir}. ` +
      `Set LIBGHOSTTY_PATH or place the library in packages/libghostty/platforms/${platformDir}/${libName}`,
  );
}

// ---------------------------------------------------------------------------
// FFI symbol definitions
// ---------------------------------------------------------------------------

/**
 * The raw FFI symbols from libghostty-vt.
 *
 * These map directly to the C API defined in ghostty/include/ghostty/vt.h.
 * The API is unstable — function signatures may change between Ghostty commits.
 */
const SYMBOLS = {
  // Terminal lifecycle
  ghostty_terminal_new: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32],
    returns: FFIType.ptr,
  },
  ghostty_terminal_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  ghostty_terminal_vt_write: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
    returns: FFIType.void,
  },
  ghostty_terminal_resize: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.void,
  },
  ghostty_terminal_reset: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  ghostty_terminal_scroll_viewport: {
    args: [FFIType.ptr, FFIType.i32],
    returns: FFIType.void,
  },

  // Formatter — extract content as plain text or HTML
  ghostty_formatter_terminal_new: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.ptr,
  },
  ghostty_formatter_format_buf: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
    returns: FFIType.u64,
  },
  ghostty_formatter_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },

  // OSC parser — shell integration, hyperlinks, clipboard
  ghostty_osc_new: {
    args: [],
    returns: FFIType.ptr,
  },
  ghostty_osc_next: {
    args: [FFIType.ptr, FFIType.u8],
    returns: FFIType.bool,
  },
  ghostty_osc_end: {
    args: [FFIType.ptr],
    returns: FFIType.ptr,
  },
  ghostty_osc_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },

  // Paste safety
  ghostty_paste_is_safe: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.bool,
  },
} as const;

// ---------------------------------------------------------------------------
// Lazy loading
// ---------------------------------------------------------------------------

/** Loaded FFI library instance. Lazy — only loaded on first use. */
let _lib: ReturnType<typeof dlopen<typeof SYMBOLS>> | null = null;
let _loadError: Error | null = null;

/**
 * Get the loaded FFI library, loading it on first access.
 * Throws if the library cannot be found or loaded.
 */
export function getLib(): ReturnType<typeof dlopen<typeof SYMBOLS>> {
  if (_lib !== null) return _lib;
  if (_loadError !== null) throw _loadError;

  try {
    const libPath = findLibrary();
    _lib = dlopen(libPath, SYMBOLS);
    return _lib;
  } catch (err) {
    _loadError = err instanceof Error ? err : new Error(String(err));
    throw _loadError;
  }
}

/**
 * Check if libghostty-vt is available on the current platform.
 * Returns true if the library can be loaded, false otherwise.
 */
export function isAvailable(): boolean {
  try {
    getLib();
    return true;
  } catch {
    return false;
  }
}

/** Re-export ptr for use by higher-level modules. */
export { ptr, toArrayBuffer };
