'use client';

import { memo } from 'react';

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

export const MarkdownPreviewPane = memo(function MarkdownPreviewPane({
  machineId,
  workingDir,
  filePath,
}: MarkdownPreviewPaneProps) {
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

  return (
    <div className="flex-1 overflow-auto p-4">
      <WorkspaceFileLinkProvider baseFilePath={filePath}>
        <MarkdownRenderer content={content.content} />
      </WorkspaceFileLinkProvider>
    </div>
  );
});
