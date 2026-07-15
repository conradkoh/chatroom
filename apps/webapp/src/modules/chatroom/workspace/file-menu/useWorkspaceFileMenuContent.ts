'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useEffect, useState } from 'react';

import { isBinaryFile } from '../../components/FileSelector/binaryDetection';
import { isMarkdownFile } from '../file-renderers';
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

  const menuFileIsBinary = contextMenuFilePath ? isBinaryFile(contextMenuFilePath) : false;
  const canCopyMenuFileContent = !!menuFileContent?.content && !menuFileIsBinary;

  const fileContentLabel =
    contextMenuFilePath && isMarkdownFile(contextMenuFilePath)
      ? 'Copy as Markdown'
      : 'Copy File Content';

  function trackContextMenuFile(filePath: string) {
    setContextMenuFilePath(filePath);
  }

  const menuContentState = {
    content: menuFileContent?.content ?? null,
    contentTruncated: menuFileContent?.truncated,
    contentDisabled: !canCopyMenuFileContent,
    fileContentLabel,
  };

  return { trackContextMenuFile, menuContentState, canCopyMenuFileContent };
}
