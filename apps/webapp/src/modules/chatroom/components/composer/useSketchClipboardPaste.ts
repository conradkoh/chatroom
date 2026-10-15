'use client';
// fallow-ignore-file complexity
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getImageFilesFromClipboard } from '../../hooks/clipboardImageFiles';

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)
  );
}

/**
 * Imports a clipboard image onto the sketch canvas.
 *
 * Listens on `document` for the whole lifetime of the sketch session: a paste event is
 * dispatched at `document.activeElement` and only bubbles up, so a handler on a descendant
 * of the dialog popup never fires once focus moves to the popup (e.g. after drawing). The
 * sketch dialog is modal, so a document listener cannot leak into the rest of the app, and
 * it is removed on unmount. Editable targets (hex input, text fields) are left untouched.
 */
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
  const importingRef = useRef(false);
  // Latest values for the long-lived document listener (avoid re-binding per render).
  const latestRef = useRef({ disabled, importPastedImage, onTransformRequested });
  useEffect(() => {
    latestRef.current = { disabled, importPastedImage, onTransformRequested };
  });

  useEffect(() => {
    const onDocumentPaste = (event: globalThis.ClipboardEvent) => {
      const { disabled, importPastedImage, onTransformRequested } = latestRef.current;
      if (importingRef.current || disabled || isEditableTarget(event.target)) return;
      const file = getImageFilesFromClipboard(event.clipboardData)[0];
      if (!file) return;
      event.preventDefault();
      importingRef.current = true;
      setIsImporting(true);
      void (async () => {
        try {
          if (await importPastedImage(file)) onTransformRequested();
          else toast.error('Failed to paste image');
        } catch {
          toast.error('Failed to paste image');
        } finally {
          importingRef.current = false;
          setIsImporting(false);
        }
      })();
    };
    document.addEventListener('paste', onDocumentPaste);
    return () => document.removeEventListener('paste', onDocumentPaste);
  }, []);

  return { isImporting };
}
