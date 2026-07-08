'use client';

import { memo, useCallback } from 'react';

import { WorkspaceTabBarItem, WorkspaceTabBarShell } from './WorkspaceTabBar';
import type { RightPaneTab } from '../hooks/useFileTabs';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RightPaneTabBarProps {
  tabs: RightPaneTab[];
  activeTabKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const RightPaneTabBar = memo(function RightPaneTabBar({
  tabs,
  activeTabKey,
  onActivate,
  onClose,
}: RightPaneTabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <WorkspaceTabBarShell testId="right-pane-tab-bar">
      {tabs.map((tab) => (
        <RightTabItem
          key={tab.key}
          tab={tab}
          isActive={tab.key === activeTabKey}
          onActivate={onActivate}
          onClose={onClose}
        />
      ))}
    </WorkspaceTabBarShell>
  );
});

// ─── Single Tab ───────────────────────────────────────────────────────────────

const RightTabItem = memo(function RightTabItem({
  tab,
  isActive,
  onActivate,
  onClose,
}: {
  tab: RightPaneTab;
  isActive: boolean;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}) {
  const handleClose = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onClose(tab.key);
    },
    [onClose, tab.key]
  );

  return (
    <WorkspaceTabBarItem
      isActive={isActive}
      label={tab.name}
      iconPath={tab.filePath}
      title={tab.filePath}
      onClick={() => onActivate(tab.key)}
      onClose={handleClose}
    />
  );
});
