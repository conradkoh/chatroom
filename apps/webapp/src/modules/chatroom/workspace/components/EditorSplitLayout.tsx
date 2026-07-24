'use client';

import type { ReactNode } from 'react';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

interface EditorSplitLayoutProps {
  primary: ReactNode;
  secondary: ReactNode | null;
  secondaryTabBar: ReactNode | null;
  defaultLayout?: [number, number];
  onLayout?: (sizes: [number, number]) => void;
}

export function EditorSplitLayout({
  primary,
  secondary,
  secondaryTabBar,
  defaultLayout = [60, 40],
  onLayout,
}: EditorSplitLayoutProps) {
  if (!secondary) {
    return <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{primary}</div>;
  }

  return (
    <ResizablePanelGroup
      data-testid="editor-split-layout"
      className="flex-1 min-h-0"
      onLayoutChanged={(sizes) => {
        if (sizes.length === 2) onLayout?.([sizes[0], sizes[1]]);
      }}
    >
      <ResizablePanel defaultSize={defaultLayout[0]} minSize={20}>
        {primary}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={defaultLayout[1]} minSize={20}>
        <div className="flex flex-col h-full min-h-0 overflow-hidden">
          {secondaryTabBar}
          {secondary}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
