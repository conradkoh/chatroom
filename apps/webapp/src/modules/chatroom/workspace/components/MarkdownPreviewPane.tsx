'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { memo, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarkdownPreviewPaneProps {
  machineId: string;
  workingDir: string;
  filePath: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

// Stable plugin array — avoids creating a new reference each render
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

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

  // Reactively fetch cached content
  const content = useSessionQuery(api.workspaceFiles.getFileContent, {
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
      <div className="prose prose-sm dark:prose-invert max-w-none text-chatroom-text-primary">
        <Markdown remarkPlugins={REMARK_PLUGINS}>{content.content}</Markdown>
      </div>
    </div>
  );
});
