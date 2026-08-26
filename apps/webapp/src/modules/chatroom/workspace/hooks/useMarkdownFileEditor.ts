'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useRequestWorkspaceFileContent } from './useRequestWorkspaceFileContent';
import { useWorkspaceFileSave } from './useWorkspaceFileSave';
import {
  isPendingOptimisticNewFile,
  isFileNotFoundError,
  isTransientNewFileReadError,
  isWorkspaceNotRegisteredError,
} from '../utils/fileContentSentinels';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

interface UseMarkdownFileEditorArgs {
  machineId: string;
  workingDir: string;
  filePath: string;
  /** When true, show empty editor immediately while content is not yet cached (optimistic new file). */
  initialEmpty?: boolean;
}

// fallow-ignore-next-line complexity
export function useMarkdownFileEditor({
  machineId,
  workingDir,
  filePath,
  initialEmpty = false,
}: UseMarkdownFileEditorArgs) {
  const normalizedWorkingDir = normalizeWorkspaceWorkingDir(workingDir);
  const loadedContent = useRequestWorkspaceFileContent({
    machineId,
    workingDir: normalizedWorkingDir,
    filePath,
  });
  const requestFileContent = useSessionMutation(api.workspaceFiles.requestFileContent);

  const [draft, setDraft] = useState<string | null>(null);
  const contentRef = useRef('');
  const saveInFlightRef = useRef(false);
  const wasOptimisticNewRef = useRef(initialEmpty || isPendingOptimisticNewFile(filePath));

  const serverContent = useMemo(() => {
    if (loadedContent === undefined) return undefined;
    if (loadedContent === null)
      return initialEmpty || isPendingOptimisticNewFile(filePath) ? '' : null;
    if (isTransientNewFileReadError(loadedContent.content, filePath)) return '';
    if (isWorkspaceNotRegisteredError(loadedContent.content)) return null;
    if (isFileNotFoundError(loadedContent.content)) return null;
    return loadedContent.content;
  }, [filePath, initialEmpty, loadedContent]);
  const content = draft ?? serverContent ?? '';
  const isDirty = draft !== null;
  contentRef.current = content;

  const getContent = useCallback(() => contentRef.current, []);

  const {
    save: saveToDisk,
    saving,
    error,
    lastSavedAt,
  } = useWorkspaceFileSave({
    machineId,
    workingDir: normalizedWorkingDir,
    filePath,
    getContent,
    operation: 'update',
  });

  const setContent = useCallback((next: string) => {
    contentRef.current = next;
    setDraft(next);
  }, []);

  const save = useCallback(async () => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    const snapshotAtStart = contentRef.current;

    try {
      await saveToDisk();
      await requestFileContent({
        machineId,
        workingDir: normalizedWorkingDir,
        filePath,
      }).catch(() => {});
      if (contentRef.current === snapshotAtStart) {
        setDraft(null);
      }
    } finally {
      saveInFlightRef.current = false;
    }
  }, [filePath, machineId, normalizedWorkingDir, requestFileContent, saveToDisk]);

  // Latch optimistic-empty state — once set, persists until real content arrives.
  if (initialEmpty || isPendingOptimisticNewFile(filePath)) {
    wasOptimisticNewRef.current = true;
  }

  const treatAsOptimisticEmpty = wasOptimisticNewRef.current;
  const loadError =
    serverContent === null
      ? loadedContent?.content && isWorkspaceNotRegisteredError(loadedContent.content)
        ? 'Workspace is not registered on this machine.'
        : loadedContent?.content && isFileNotFoundError(loadedContent.content)
          ? 'File not found.'
          : null
      : null;
  const isLoading =
    !loadError &&
    !treatAsOptimisticEmpty &&
    (loadedContent === undefined ||
      loadedContent === null ||
      isTransientNewFileReadError(loadedContent?.content, filePath));

  const encoding = loadedContent?.encoding ?? null;

  return {
    content,
    setContent,
    isDirty,
    contentRef,
    save,
    saving,
    error: error ?? loadError,
    lastSavedAt,
    isLoading,
    encoding,
  };
}
