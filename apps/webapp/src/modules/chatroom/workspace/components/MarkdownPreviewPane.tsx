'use client';

import { memo } from 'react';

import { MarkdownRenderer } from '../file-renderers';
import { useRequestWorkspaceFileContent } from '../hooks/useRequestWorkspaceFileContent';

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

  if (content === undefined || content === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-chatroom-text-muted text-sm">
        <div className="w-4 h-4 border-2 border-chatroom-border border-t-chatroom-accent animate-spin mr-2" />
        Loading preview…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <MarkdownRenderer content={content.content} />
    </div>
  );
});
