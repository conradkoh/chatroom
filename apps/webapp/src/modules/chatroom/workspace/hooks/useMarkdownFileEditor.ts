'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useRequestWorkspaceFileContent } from './useRequestWorkspaceFileContent';
import { useWorkspaceFileSave } from './useWorkspaceFileSave';
import {
  isPendingOptimisticNewFile,
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

  const [content, setContentState] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const contentRef = useRef(content);
  const saveInFlightRef = useRef(false);
  const loadedPathRef = useRef(filePath);

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
    setContentState(next);
    setIsDirty(true);
  }, []);

  useEffect(() => {
    if (loadedPathRef.current !== filePath) {
      loadedPathRef.current = filePath;
      contentRef.current = '';
      setContentState('');
      setIsDirty(false);
    }
  }, [filePath]);

  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (loadedContent === undefined) return;
    if (loadedContent === null) {
      if (!isDirty && (initialEmpty || isPendingOptimisticNewFile(filePath))) {
        contentRef.current = '';
        setContentState('');
      }
      setLoadError(null);
      return;
    }
    if (isDirty) return;
    if (isWorkspaceNotRegisteredError(loadedContent.content)) {
      setLoadError('Workspace is not registered on this machine.');
      return;
    }
    if (isTransientNewFileReadError(loadedContent.content, filePath)) return;
    setLoadError(null);
    contentRef.current = loadedContent.content;
    setContentState(loadedContent.content);
  }, [filePath, initialEmpty, isDirty, loadedContent]);

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
        setIsDirty(false);
      }
    } finally {
      saveInFlightRef.current = false;
    }
  }, [filePath, machineId, normalizedWorkingDir, requestFileContent, saveToDisk]);

  const isPendingCreate = isPendingOptimisticNewFile(filePath);
  const isLoading =
    !loadError &&
    !initialEmpty &&
    !isPendingCreate &&
    (loadedContent === undefined ||
      loadedContent === null ||
      isTransientNewFileReadError(loadedContent?.content, filePath));

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
  };
}
