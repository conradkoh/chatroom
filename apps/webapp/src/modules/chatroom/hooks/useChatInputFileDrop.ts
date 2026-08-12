'use client';
// fallow-ignore-file complexity

import { buildChatAttachmentUploadPath } from '@workspace/backend/src/domain/constants/chat-attachment-upload-path';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type RefObject,
  type ClipboardEvent,
} from 'react';
import { toast } from 'sonner';

import { getImageFilesFromClipboard } from './clipboardImageFiles';
import { formatFileReferenceFinal } from '../triggers/fileReferenceQuery';
import { insertMultipleAtCaret } from '../utils/insertTextAtCaret';
import { useWorkspaceUploadJobs } from '../workspace/hooks/useWorkspaceUploadJobs';
import {
  getFilesFromDrop,
  isOsFileDrag,
  shouldCommitOsFileDragLeave,
} from '../workspace/utils/osFileDrag';

type UseChatInputFileDropArgs = {
  machineId?: string | null;
  workingDir?: string | null;
  message: string;
  setMessage: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onUploadComplete?: () => void;
};

export function useChatInputFileDrop({
  machineId,
  workingDir,
  message,
  setMessage,
  textareaRef,
  onUploadComplete,
}: UseChatInputFileDropArgs) {
  const dragDepthRef = useRef(0);
  const pendingSelectionRef = useRef<{ text: string; cursor: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const { jobs, startUpload } = useWorkspaceUploadJobs({
    machineId: machineId ?? null,
    workingDir: workingDir ?? null,
    errorDismissMs: false,
    onUploadComplete: () => onUploadComplete?.(),
    onUploadFailed: (filePath, error) =>
      toast.error(`Upload failed: ${filePath}`, { description: error }),
  });

  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    if (!pending || message !== pending.text) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.setSelectionRange(pending.cursor, pending.cursor);
    pendingSelectionRef.current = null;
  }, [message, textareaRef]);

  const handleDragEnter = useCallback((event: DragEvent) => {
    if (!isOsFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    if (!isOsFileDrag(event)) return;
    if (!shouldCommitOsFileDragLeave(event, event.currentTarget)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((event: DragEvent) => {
    if (!isOsFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const attachFiles = useCallback(
    (files: File[]) => {
      if (!machineId || !workingDir) {
        toast.error('Connect a workspace to attach files');
        return;
      }
      if (files.length === 0) return;

      const caret = textareaRef.current?.selectionStart ?? message.length;
      const paths = files.map((file) =>
        buildChatAttachmentUploadPath(file.name, crypto.randomUUID())
      );
      const refs = paths.map((path) => formatFileReferenceFinal(path));
      const { newText, newCursorPos } = insertMultipleAtCaret(message, caret, refs);
      setMessage(newText);
      pendingSelectionRef.current = { text: newText, cursor: newCursorPos };

      files.forEach((file, index) => {
        const path = paths[index];
        if (!path) return;
        void startUpload(path, file, { uploadKind: 'chatAttachment' });
      });
    },
    [machineId, message, setMessage, startUpload, textareaRef, workingDir]
  );

  const handleDrop = useCallback(
    (event: DragEvent) => {
      if (!isOsFileDrag(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);

      attachFiles(getFilesFromDrop(event));
    },
    [attachFiles]
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      attachFiles(files);
      event.target.value = '';
    },
    [attachFiles]
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const images = getImageFilesFromClipboard(event.clipboardData);
      if (images.length === 0) return;
      event.preventDefault();
      attachFiles(images);
    },
    [attachFiles]
  );

  return {
    uploadJobs: jobs,
    isDragging,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    fileInputRef,
    handleAttachClick,
    handleFileInputChange,
    handlePaste,
  };
}
