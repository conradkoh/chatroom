'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useRequestWorkspaceFileContent } from './useRequestWorkspaceFileContent';
import { useWorkspaceFileSave } from './useWorkspaceFileSave';
import {
  isPendingOptimisticNewFile,
  isTransientNewFileReadError,
} from '../utils/fileContentSentinels';

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
  const loadedContent = useRequestWorkspaceFileContent({ machineId, workingDir, filePath });
  const requestFileContent = useSessionMutation(api.workspaceFiles.requestFileContent);

  const [content, setContentState] = useState('');
  const [isDirty, setIsDirty] = useState(false);
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
    workingDir,
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
      return;
    }
    if (isDirty) return;
    if (isTransientNewFileReadError(loadedContent.content, filePath)) return;
    contentRef.current = loadedContent.content;
    setContentState(loadedContent.content);
  }, [filePath, initialEmpty, isDirty, loadedContent]);

  const save = useCallback(async () => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    const snapshotAtStart = contentRef.current;

    try {
      await saveToDisk();
      await requestFileContent({ machineId, workingDir, filePath }).catch(() => {});
      if (contentRef.current === snapshotAtStart) {
        setIsDirty(false);
      }
    } finally {
      saveInFlightRef.current = false;
    }
  }, [filePath, machineId, requestFileContent, saveToDisk, workingDir]);

  const isPendingCreate = isPendingOptimisticNewFile(filePath);
  const isLoading =
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
    error,
    lastSavedAt,
    isLoading,
  };
}
