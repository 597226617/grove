/**
 * File/directory ingestion into CAS.
 *
 * Walks the given paths (files or directories) and stores each file
 * in the content-addressed store. Returns a map of relative path → content hash.
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import type { ContentStore } from "../../core/cas.js";

/**
 * Ingest files and directories into CAS.
 *
 * For each path:
 * - If it's a file, store it directly. The artifact name is the basename.
 * - If it's a directory, recursively walk and store all files.
 *   Artifact names are relative paths from the directory root.
 *
 * @param cas - Content-addressable store to write into.
 * @param paths - File or directory paths to ingest.
 * @returns Map of artifact name → content hash.
 */
export async function ingestFiles(
  cas: ContentStore,
  paths: readonly string[],
): Promise<Record<string, string>> {
  const artifacts: Record<string, string> = {};

  for (const p of paths) {
    const info = await stat(p);
    if (info.isDirectory()) {
      await walkDirectory(cas, p, p, artifacts);
    } else if (info.isFile()) {
      const name = p.split("/").pop() ?? p;
      const hash = await cas.putFile(p);
      artifacts[name] = hash;
    }
  }

  return artifacts;
}

async function walkDirectory(
  cas: ContentStore,
  rootDir: string,
  currentDir: string,
  artifacts: Record<string, string>,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      // Skip .grove and .git directories
      if (entry.name === ".grove" || entry.name === ".git") {
        continue;
      }
      await walkDirectory(cas, rootDir, fullPath, artifacts);
    } else if (entry.isFile()) {
      const name = relative(rootDir, fullPath);
      const hash = await cas.putFile(fullPath);
      artifacts[name] = hash;
    }
  }
}
