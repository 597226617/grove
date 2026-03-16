const std = @import("std");

/// Build libghostty-vt from source for the target platform.
///
/// Produces a shared library (.dylib on macOS, .so on Linux) that
/// the Bun FFI bindings in src/ffi.ts load via dlopen.
///
/// Usage:
///   zig build lib-vt                           # native target
///   zig build lib-vt -Dtarget=aarch64-macos    # cross-compile
///   zig build lib-vt -Dtarget=x86_64-linux     # cross-compile
pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Fetch ghostty dependency
    const ghostty_dep = b.dependency("ghostty", .{
        .target = target,
        .optimize = optimize,
    });

    // Build libghostty-vt as a shared library
    const lib = b.addSharedLibrary(.{
        .name = "ghostty-vt",
        .target = target,
        .optimize = optimize,
    });

    // Link against the ghostty vt module
    if (ghostty_dep.module("ghostty-vt")) |vt_mod| {
        lib.addModule("ghostty-vt", vt_mod);
    }

    // Install the shared library
    b.installArtifact(lib);

    // Named step for convenience
    const lib_step = b.step("lib-vt", "Build libghostty-vt shared library");
    lib_step.dependOn(&lib.step);
}
