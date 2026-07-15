'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useState } from 'react';

import { isBinaryFile } from '../../components/FileSelector/binaryDetection';
import { isMarkdownFile } from '../file-renderers';
import type { WorkspaceFileMenuContentState } from './types';
import { useFileContent } from '../hooks/useFileContent';

export function useWorkspaceFileMenuContent(machineId: string | null, workingDir: string | null) {
  const [contextMenuFilePath, setContextMenuFilePath] = useState<string | null>(null);

  const menuFileContent = useFileContent(
    contextMenuFilePath && machineId && workingDir
      ? { machineId, workingDir, filePath: contextMenuFilePath }
      : 'skip'
  );

  const requestContent = useSessionMutation(api.workspaceFiles.requestFileContent);

  useEffect(() => {
    if (contextMenuFilePath && machineId && workingDir) {
      requestContent({ machineId, workingDir, filePath: contextMenuFilePath }).catch(() => {});
    }
  }, [contextMenuFilePath, machineId, workingDir, requestContent]);

  // fallow-ignore-next-line complexity
  const getMenuContentStateForPath = useCallback(
    (filePath: string): WorkspaceFileMenuContentState => {
      const pathMatches = contextMenuFilePath === filePath;
      const menuFileIsBinary = isBinaryFile(filePath);
      const content = pathMatches ? (menuFileContent?.content ?? null) : null;
      const canCopy = !!content && !menuFileIsBinary;

      return {
        content,
        contentTruncated: pathMatches ? menuFileContent?.truncated : undefined,
        contentDisabled: !canCopy,
        fileContentLabel: isMarkdownFile(filePath) ? 'Copy as Markdown' : 'Copy File Content',
      };
    },
    [contextMenuFilePath, menuFileContent]
  );

  function trackContextMenuFile(filePath: string) {
    setContextMenuFilePath(filePath);
  }

  return { trackContextMenuFile, getMenuContentStateForPath };
}
