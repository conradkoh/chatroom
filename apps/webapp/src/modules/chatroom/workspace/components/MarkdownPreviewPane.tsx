'use client';

import { memo, useDeferredValue } from 'react';

import { WorkspaceFileLinkProvider } from '../../context/WorkspaceFileLinkContext';
import { MarkdownRenderer } from '../file-renderers';
import { useRequestWorkspaceFileContent } from '../hooks/useRequestWorkspaceFileContent';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarkdownPreviewPaneProps {
  machineId: string;
  workingDir: string;
  filePath: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

function MarkdownPreviewBody({ filePath, markdown }: { filePath: string; markdown: string }) {
  const deferredMarkdown = useDeferredValue(markdown);

  return (
    <div className="flex-1 overflow-auto p-4 [contain:layout_paint_style] isolate">
      <WorkspaceFileLinkProvider baseFilePath={filePath}>
        <MarkdownRenderer content={deferredMarkdown} />
      </WorkspaceFileLinkProvider>
    </div>
  );
}

export const MarkdownPreviewPane = memo(
  function MarkdownPreviewPane({ machineId, workingDir, filePath }: MarkdownPreviewPaneProps) {
    const content = useRequestWorkspaceFileContent({ machineId, workingDir, filePath });

    if (content === null) {
      return (
        <div className="flex-1 flex items-center justify-center text-chatroom-text-muted text-sm">
          Failed to load preview.
        </div>
      );
    }

    if (content === undefined) {
      return (
        <div className="flex-1 flex items-center justify-center gap-2 text-chatroom-text-muted text-sm">
          <ChatroomLoader size="sm" />
          Loading preview…
        </div>
      );
    }

    return <MarkdownPreviewBody filePath={filePath} markdown={content.content} />;
  },
  (prev, next) =>
    prev.machineId === next.machineId &&
    prev.workingDir === next.workingDir &&
    prev.filePath === next.filePath
);
