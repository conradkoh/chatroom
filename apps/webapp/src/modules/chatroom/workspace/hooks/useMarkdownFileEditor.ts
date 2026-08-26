'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { resolveEditorLoadState, resolveLoadedServerContent } from './markdownFileEditorState';
import { useRequestWorkspaceFileContent } from './useRequestWorkspaceFileContent';
import { useWorkspaceFileSave } from './useWorkspaceFileSave';
import { isPendingOptimisticNewFile } from '../utils/fileContentSentinels';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

interface UseMarkdownFileEditorArgs {
  machineId: string;
  workingDir: string;
  filePath: string;
  /** When true, show empty editor immediately while content is not yet cached (optimistic new file). */
  initialEmpty?: boolean;
}

async function persistEditorSave(args: {
  saveToDisk: () => Promise<void>;
  requestFileContent: () => Promise<unknown>;
  contentRef: MutableRefObject<string>;
  setDraft: (value: string | null) => void;
  saveInFlightRef: MutableRefObject<boolean>;
}): Promise<void> {
  if (args.saveInFlightRef.current) return;
  args.saveInFlightRef.current = true;
  const snapshotAtStart = args.contentRef.current;
  try {
    await args.saveToDisk();
    await args.requestFileContent().catch(() => {});
    if (args.contentRef.current === snapshotAtStart) args.setDraft(null);
  } finally {
    args.saveInFlightRef.current = false;
  }
}

function latchOptimisticEmpty(
  ref: MutableRefObject<boolean>,
  initialEmpty: boolean,
  filePath: string
): void {
  if (initialEmpty || isPendingOptimisticNewFile(filePath)) ref.current = true;
}

function resolveEditorContent(
  draft: string | null,
  serverContent: string | null | undefined
): string {
  return draft ?? serverContent ?? '';
}

function resolveEditorError(
  error: string | null | undefined,
  loadError: string | null
): string | null {
  return error ?? loadError;
}

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

  const serverContent = useMemo(
    () => resolveLoadedServerContent(loadedContent, filePath, initialEmpty),
    [filePath, initialEmpty, loadedContent]
  );
  const content = resolveEditorContent(draft, serverContent);
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
    await persistEditorSave({
      saveToDisk,
      requestFileContent: () =>
        requestFileContent({ machineId, workingDir: normalizedWorkingDir, filePath }),
      contentRef,
      setDraft,
      saveInFlightRef,
    });
  }, [filePath, machineId, normalizedWorkingDir, requestFileContent, saveToDisk]);

  // Latch optimistic-empty state — once set, persists until real content arrives.
  latchOptimisticEmpty(wasOptimisticNewRef, initialEmpty, filePath);

  const treatAsOptimisticEmpty = wasOptimisticNewRef.current;
  const { loadError, isLoading } = resolveEditorLoadState(
    serverContent,
    loadedContent,
    filePath,
    treatAsOptimisticEmpty
  );

  const encoding = loadedContent?.encoding ?? null;

  return {
    content,
    setContent,
    isDirty,
    contentRef,
    save,
    saving,
    error: resolveEditorError(error, loadError),
    lastSavedAt,
    isLoading,
    encoding,
  };
}
