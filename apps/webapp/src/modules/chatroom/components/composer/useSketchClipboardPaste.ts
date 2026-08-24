'use client';
// fallow-ignore-file complexity
import { useState, type ClipboardEvent } from 'react';
import { toast } from 'sonner';

import { getImageFilesFromClipboard } from '../../hooks/clipboardImageFiles';

export function useSketchClipboardPaste({
  disabled,
  importPastedImage,
  onTransformRequested,
}: {
  disabled: boolean;
  importPastedImage: (file: File) => Promise<boolean>;
  onTransformRequested: () => void;
}) {
  const [isImporting, setIsImporting] = useState(false);
  const onPaste = async (event: ClipboardEvent) => {
    if (isImporting) return;
    if (
      disabled ||
      (event.target instanceof HTMLElement &&
        (['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable))
    )
      return;
    const file = getImageFilesFromClipboard(event.clipboardData)[0];
    if (!file) return;
    event.preventDefault();
    setIsImporting(true);
    try {
      if (await importPastedImage(file)) onTransformRequested();
      else toast.error('Failed to paste image');
    } catch {
      toast.error('Failed to paste image');
    } finally {
      setIsImporting(false);
    }
  };
  return { onPaste, isImporting };
}
