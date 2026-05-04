'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { memo, useEffect } from 'react';

import { MarkdownRenderer } from '../file-renderers';
import { useFileContent } from '../hooks/useFileContent';

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
  // Request file content from daemon
  const requestContent = useSessionMutation(api.workspaceFiles.requestFileContent);

  useEffect(() => {
    requestContent({ machineId, workingDir, filePath }).catch(() => {});
  }, [machineId, workingDir, filePath, requestContent]);

  // Reactively fetch cached content (with transparent decompression)
  const content = useFileContent({
    machineId,
    workingDir,
    filePath,
  });

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
