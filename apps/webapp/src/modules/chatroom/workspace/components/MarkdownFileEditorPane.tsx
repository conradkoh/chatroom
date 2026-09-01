'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { memo, useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { MarkdownFileEditorHeader } from './MarkdownFileEditorHeader';
import {
  MarkdownFileEditorBinaryState,
  MarkdownFileEditorLoadingState,
} from './MarkdownFileEditorStates';
import { SelectionMatchTextarea } from './SelectionMatchTextarea';
import { pendingOptimisticNewFilePaths } from '../hooks/pendingOptimisticNewFilePaths';
import { useRemoteSelectionContextMenu } from '../hooks/useExplorerSelectionKeyboard';
import { useMarkdownFileEditor } from '../hooks/useMarkdownFileEditor';
import { useMarkdownFileEditorPaneActions } from '../hooks/useMarkdownFileEditorPaneActions';

const EMPTY_FILE_PLACEHOLDER = 'This file is empty.';

interface MarkdownFileEditorPaneProps {
  machineId: string;
  workingDir: string;
  filePath: string;
  onOpenPreview?: (filePath: string) => void;
  onSendSelectionToComposer?: (payload: { filePath: string; selectedText: string }) => void;
  onOpenSelectionOnRemote?: (filePath: string, selectedText: string) => void;
}

export const MarkdownFileEditorPane = memo(function MarkdownFileEditorPane({
  machineId,
  workingDir,
  filePath,
  onOpenPreview,
  onOpenSelectionOnRemote,
}: MarkdownFileEditorPaneProps) {
  const initialEmpty = pendingOptimisticNewFilePaths.has(filePath);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const { onContextMenu, selectionMenu } = useRemoteSelectionContextMenu(
    filePath,
    onOpenSelectionOnRemote
  );
  const { content, setContent, isDirty, contentRef, save, saving, error, isLoading, encoding } =
    useMarkdownFileEditor({ machineId, workingDir, filePath, initialEmpty });
  const purgeFileContentEntry = useSessionMutation(api.workspaceFiles.purgeFileContentEntryV2);
  const [isDismissingError, setIsDismissingError] = useState(false);
  const isWorkspaceRegistrationError = error === 'Workspace is not registered on this machine.';

  const handleDismissError = useCallback(async () => {
    if (!isWorkspaceRegistrationError || isDismissingError) return;
    setIsDismissingError(true);
    try {
      await purgeFileContentEntry({ machineId, workingDir, filePath });
    } catch {
      toast.error('Could not dismiss workspace registration error');
    } finally {
      setIsDismissingError(false);
    }
  }, [
    filePath,
    isDismissingError,
    isWorkspaceRegistrationError,
    machineId,
    purgeFileContentEntry,
    workingDir,
  ]);
  const { handleKeyDown, handleCopyMarkdown } = useMarkdownFileEditorPaneActions({
    editorContainerRef,
    contentRef,
    save,
  });

  if (encoding === 'binary') {
    return <MarkdownFileEditorBinaryState filePath={filePath} />;
  }

  if (isLoading) {
    return <MarkdownFileEditorLoadingState />;
  }

  return (
    <div
      ref={editorContainerRef}
      className="flex-1 flex flex-col min-h-0 overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      {selectionMenu}
      <MarkdownFileEditorHeader
        filePath={filePath}
        isDirty={isDirty}
        saving={saving}
        error={error}
        onCopy={() => void handleCopyMarkdown()}
        onOpenPreview={onOpenPreview}
        onDismissError={isWorkspaceRegistrationError ? () => void handleDismissError() : undefined}
        isDismissingError={isDismissingError}
      />
      <SelectionMatchTextarea
        content={content}
        placeholder={EMPTY_FILE_PLACEHOLDER}
        ariaLabel={`Edit ${filePath}`}
        onChange={setContent}
        onContextMenu={onContextMenu}
      />
    </div>
  );
});
