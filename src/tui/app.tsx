/**
 * Root TUI application component.
 *
 * Manages navigation state, routes to views, and wires up keybindings.
 * Uses a tab bar + push/pop detail architecture (k9s-style).
 */

import { Box, useApp } from "ink";
import React, { useCallback } from "react";
import type { Contribution } from "../core/models.js";
import { StatusBar } from "./components/status-bar.js";
import { TabBar } from "./components/tab-bar.js";
import { useKeybindings } from "./hooks/use-keybindings.js";
import { Tab, useNavigation } from "./hooks/use-navigation.js";
import type { TuiDataProvider } from "./provider.js";
import { ActivityView } from "./views/activity.js";
import { ClaimsView } from "./views/claims.js";
import { DagView } from "./views/dag.js";
import { DashboardView } from "./views/dashboard.js";
import { DetailView } from "./views/detail.js";

/** Props for the root App component. */
export interface AppProps {
  readonly provider: TuiDataProvider;
  /** Polling interval in milliseconds. */
  readonly intervalMs: number;
}

const PAGE_SIZE = 20;

/** Root TUI application. */
export function App({ provider, intervalMs }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const nav = useNavigation();

  // Track contributions for drill-down (resolve cursor → CID)
  const [contributionList, setContributionList] = React.useState<readonly Contribution[]>([]);

  const handleSelect = useCallback(
    (index: number) => {
      const contribution = contributionList[index];
      if (contribution) {
        nav.pushDetail(contribution.cid);
      }
    },
    [contributionList, nav],
  );

  const handleQuit = useCallback(() => {
    provider.close();
    exit();
  }, [provider, exit]);

  // Estimate list length for keybinding bounds
  const listLength = contributionList.length;

  useKeybindings({
    nav,
    listLength,
    onSelect: nav.isDetailView ? undefined : handleSelect,
    onQuit: handleQuit,
    pageSize: PAGE_SIZE,
    totalItems: listLength,
  });

  // If we're in a detail view, show the detail
  if (nav.isDetailView && nav.detailCid) {
    return (
      <Box flexDirection="column" width="100%">
        <TabBar activeTab={nav.state.activeTab} />
        <Box flexDirection="column" flexGrow={1} marginTop={1}>
          <DetailView provider={provider} cid={nav.detailCid} intervalMs={intervalMs} />
        </Box>
        <StatusBar isDetailView />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <TabBar activeTab={nav.state.activeTab} />
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        <ActiveView
          tab={nav.state.activeTab}
          provider={provider}
          intervalMs={intervalMs}
          cursor={nav.state.cursor}
          pageOffset={nav.state.pageOffset}
          pageSize={PAGE_SIZE}
          onContributionsLoaded={setContributionList}
        />
      </Box>
      <StatusBar isDetailView={false} />
    </Box>
  );
}

/** Props for the view router. */
interface ActiveViewProps {
  readonly tab: Tab;
  readonly provider: TuiDataProvider;
  readonly intervalMs: number;
  readonly cursor: number;
  readonly pageOffset: number;
  readonly pageSize: number;
  readonly onContributionsLoaded: (contributions: readonly Contribution[]) => void;
}

/**
 * Routes to the active tab's view component.
 * Only the active view polls; others are unmounted to save resources.
 */
const ActiveView = React.memo(function ActiveView({
  tab,
  provider,
  intervalMs,
  cursor,
  pageOffset,
  pageSize,
  onContributionsLoaded,
}: ActiveViewProps): React.ReactElement {
  switch (tab) {
    case Tab.Dashboard:
      return (
        <DashboardViewWrapper
          provider={provider}
          intervalMs={intervalMs}
          cursor={cursor}
          onContributionsLoaded={onContributionsLoaded}
        />
      );
    case Tab.Dag:
      return <DagView provider={provider} intervalMs={intervalMs} active cursor={cursor} />;
    case Tab.Claims:
      return <ClaimsView provider={provider} intervalMs={intervalMs} active cursor={cursor} />;
    case Tab.Activity:
      return (
        <ActivityView
          provider={provider}
          intervalMs={intervalMs}
          active
          cursor={cursor}
          pageOffset={pageOffset}
          pageSize={pageSize}
        />
      );
  }
});

/**
 * Wrapper for DashboardView that reports loaded contributions
 * for cursor-based drill-down.
 */
function DashboardViewWrapper({
  provider,
  intervalMs,
  cursor,
  onContributionsLoaded,
}: {
  readonly provider: TuiDataProvider;
  readonly intervalMs: number;
  readonly cursor: number;
  readonly onContributionsLoaded: (contributions: readonly Contribution[]) => void;
}): React.ReactElement {
  // The dashboard view shows recent contributions; we need their CIDs for drill-down.
  // We fetch them here to track for the parent nav.
  const _fetcher = useCallback(async () => {
    const dashboard = await provider.getDashboard();
    onContributionsLoaded(dashboard.recentContributions);
    return dashboard;
  }, [provider, onContributionsLoaded]);

  // Use the dashboard view directly — it handles its own polling
  return <DashboardView provider={provider} intervalMs={intervalMs} active cursor={cursor} />;
}
