/**
 * VFS browser view — browse Nexus zone VFS tree.
 *
 * Only available when provider supports TuiVfsProvider (capabilities.vfs).
 * Shows a directory listing with navigation.
 */

import React, { useCallback, useState } from "react";
import { Table } from "../components/table.js";
import { usePolledData } from "../hooks/use-polled-data.js";
import type { FsEntry, TuiDataProvider, TuiVfsProvider } from "../provider.js";

/** Props for the VFS browser view. */
export interface VfsBrowserProps {
  readonly provider: TuiDataProvider;
  readonly intervalMs: number;
  readonly active: boolean;
  readonly cursor: number;
}

const COLUMNS = [
  { header: "NAME", key: "name", width: 32 },
  { header: "TYPE", key: "type", width: 10 },
  { header: "SIZE", key: "size", width: 12 },
] as const;

/** Check if provider supports VFS. */
function isVfsProvider(provider: TuiDataProvider): provider is TuiDataProvider & TuiVfsProvider {
  return provider.capabilities.vfs && "listPath" in provider;
}

/** Format bytes to human-readable. */
function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** VFS browser view component. */
export const VfsBrowserView: React.NamedExoticComponent<VfsBrowserProps> = React.memo(
  function VfsBrowserView({
    provider,
    intervalMs,
    active,
    cursor,
  }: VfsBrowserProps): React.ReactNode {
    const [currentPath, _setCurrentPath] = useState("/");

    const fetcher = useCallback(async () => {
      if (!isVfsProvider(provider)) return [] as readonly FsEntry[];
      return provider.listPath(currentPath);
    }, [provider, currentPath]);

    const { data: entries, loading } = usePolledData<readonly FsEntry[]>(
      fetcher,
      intervalMs,
      active && isVfsProvider(provider),
    );

    if (!isVfsProvider(provider)) {
      return (
        <box>
          <text opacity={0.5}>VFS requires Nexus provider (--nexus)</text>
        </box>
      );
    }

    if (loading && !entries) {
      return (
        <box>
          <text opacity={0.5}>Loading VFS...</text>
        </box>
      );
    }

    const rows = (entries ?? []).map((entry) => ({
      name: entry.type === "directory" ? `${entry.name}/` : entry.name,
      type: entry.type,
      size: formatSize(entry.sizeBytes),
    }));

    return (
      <box flexDirection="column">
        <box marginBottom={1}>
          <text color="#888888">Path: {currentPath}</text>
        </box>
        {rows.length === 0 ? (
          <text opacity={0.5}>(empty directory)</text>
        ) : (
          <Table columns={[...COLUMNS]} rows={rows} cursor={cursor} />
        )}
      </box>
    );
  },
);
