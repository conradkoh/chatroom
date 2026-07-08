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
  onTabDoubleClick?: (tab: RightPaneTab) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const RightPaneTabBar = memo(function RightPaneTabBar({
  tabs,
  activeTabKey,
  onActivate,
  onClose,
  onTabDoubleClick,
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
          onTabDoubleClick={onTabDoubleClick}
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
  onTabDoubleClick,
}: {
  tab: RightPaneTab;
  isActive: boolean;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onTabDoubleClick?: (tab: RightPaneTab) => void;
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
      onDoubleClick={onTabDoubleClick ? () => onTabDoubleClick(tab) : undefined}
      onClose={handleClose}
    />
  );
});
