const std = @import("std");

/// Build libghostty-vt shared library from the Ghostty dependency.
///
/// Uses the ghostty-vt Zig module and re-exports it as a shared library
/// with C API symbols for bun:ffi consumption.
///
/// Usage:
///   zig build                                # native, debug
///   zig build -Doptimize=ReleaseFast         # native, optimized
pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const lib_vt_step = b.step("lib-vt", "Build libghostty-vt shared library");

    const ghostty_dep = b.dependency("ghostty", .{
        .target = target,
        .optimize = optimize,
    });

    // Get the ghostty-vt module from the dependency
    const vt_mod = ghostty_dep.module("ghostty-vt");

    // Build a shared library that re-exports the ghostty-vt C API
    const root_mod = b.createModule(.{
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
    });
    root_mod.addImport("ghostty-vt", vt_mod);

    const lib = b.addLibrary(.{
        .name = "ghostty-vt",
        .root_module = root_mod,
        .linkage = .dynamic,
    });

    const install = b.addInstallArtifact(lib, .{});
    lib_vt_step.dependOn(&install.step);
    b.getInstallStep().dependOn(&install.step);
}
