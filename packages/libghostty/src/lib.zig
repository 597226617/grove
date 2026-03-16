// Re-export the ghostty-vt C API as a shared library.
// This is the Zig entry point that produces the .dylib/.so loaded by bun:ffi.
pub usingnamespace @import("ghostty-vt");
