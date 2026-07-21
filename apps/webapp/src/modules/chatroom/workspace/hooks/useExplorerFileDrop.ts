'use client';
// fallow-ignore-file complexity

import { getBlockedUploadTargetReason } from '@workspace/backend/src/domain/constants/workspace-upload-path-policy';
import { useCallback, useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';

import type { ExplorerDropTarget } from '../utils/explorerDropTarget';
import {
  getExplorerRootDropTarget,
  readExplorerDropTargetFromElement,
} from '../utils/explorerDropTarget';

type PendingUpload = {
  file: File;
  targetDir: string;
};

function isOsFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

function getFilesFromDrop(event: DragEvent): File[] {
  return Array.from(event.dataTransfer.files);
}

function joinUploadPath(targetDir: string, fileName: string): string {
  const trimmedName = fileName.trim();
  if (!targetDir) return trimmedName;
  return `${targetDir.replace(/\/$/, '')}/${trimmedName}`;
}

export function useExplorerFileDrop() {
  const [dropHighlightPath, setDropHighlightPath] = useState<string | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const queueRef = useRef<File[]>([]);
  const targetDirRef = useRef('');
  const [remainingCount, setRemainingCount] = useState(0);

  const resolveDropTarget = useCallback((event: DragEvent): ExplorerDropTarget => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    return readExplorerDropTargetFromElement(element) ?? getExplorerRootDropTarget();
  }, []);

  const openNextUploadDialog = useCallback(() => {
    const nextFile = queueRef.current.shift();
    if (!nextFile) {
      setPendingUpload(null);
      setUploadDialogOpen(false);
      setRemainingCount(0);
      return;
    }

    setRemainingCount(queueRef.current.length);
    setPendingUpload({ file: nextFile, targetDir: targetDirRef.current });
    setUploadDialogOpen(true);
  }, []);

  const handleDragOver = useCallback(
    (event: DragEvent) => {
      if (!isOsFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';

      const target = resolveDropTarget(event);
      setDropHighlightPath(target.highlightPath);
    },
    [resolveDropTarget]
  );

  const handleDragLeave = useCallback((event: DragEvent) => {
    if (!isOsFileDrag(event)) return;
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDropHighlightPath(null);
  }, []);

  // fallow-ignore-next-line complexity
  const handleDrop = useCallback(
    (event: DragEvent) => {
      if (!isOsFileDrag(event)) return;
      event.preventDefault();
      setDropHighlightPath(null);

      const files = getFilesFromDrop(event);
      if (files.length === 0) return;

      const target = resolveDropTarget(event);
      const blockedReason = getBlockedUploadTargetReason(
        joinUploadPath(target.targetDir, files[0]?.name ?? '')
      );
      if (blockedReason) {
        toast.error(blockedReason);
        return;
      }

      targetDirRef.current = target.targetDir;
      queueRef.current = files;
      openNextUploadDialog();
    },
    [openNextUploadDialog, resolveDropTarget]
  );

  const handleUploadDialogOpenChange = useCallback(
    (open: boolean) => {
      setUploadDialogOpen(open);
      if (!open && queueRef.current.length > 0) {
        openNextUploadDialog();
      }
    },
    [openNextUploadDialog]
  );

  const handleUploadContinue = useCallback(() => {
    if (queueRef.current.length > 0) {
      openNextUploadDialog();
      return;
    }
    setRemainingCount(0);
  }, [openNextUploadDialog]);

  return {
    dropHighlightPath,
    uploadDialogOpen,
    pendingUpload,
    remainingCount,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleUploadDialogOpenChange,
    handleUploadContinue,
  };
}
