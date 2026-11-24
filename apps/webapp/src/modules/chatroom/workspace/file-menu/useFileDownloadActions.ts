import { useCallback, useRef, useState } from 'react';

import {
  downloadFileName,
  exportFileAsDocx,
  exportFileAsPdf,
  getDownloadFormat,
  saveTextFile,
  type DownloadFormat,
} from '../../lib/messageExport';

const MARKDOWN_SAVE_EXTENSIONS = ['.md', '.markdown', '.mdx'];
const EXPORTERS = { docx: exportFileAsDocx, pdf: exportFileAsPdf } as const;
const LOG_LABELS = { md: 'Markdown', docx: 'DOCX', pdf: 'PDF' } as const;

export interface UseFileDownloadActionsArgs {
  filePath: string;
  /** The loaded saved content. `''` is a valid, empty file; `null` means unavailable. */
  content: string | null;
  /** availability.kind === 'ready'. */
  enabled: boolean;
  /** Host clears its feedback slot. */
  onStart?: () => void;
  /** Format-specific failure copy; the host renders it in its inline slot. */
  onError?: (message: string) => void;
  /** Host closes the menu after the run (success, cancel, or failure). */
  onRequestClose?: () => void;
}

interface DownloadRun {
  format: DownloadFormat;
  filePath: string;
  content: string;
  onError?: (message: string) => void;
  onRequestClose?: () => void;
  /** Releases the busy guard and clears the busy row. */
  onSettled: () => void;
}

/** Markdown writes the source bytes; DOCX/PDF go through the file exporters. */
async function saveFormat(
  run: Pick<DownloadRun, 'format' | 'filePath' | 'content'>
): Promise<void> {
  if (run.format === 'md') {
    const definition = getDownloadFormat('md');
    await saveTextFile(
      downloadFileName(run.filePath, 'md'),
      run.content,
      definition.mimeType,
      MARKDOWN_SAVE_EXTENSIONS
    );
    return;
  }
  await EXPORTERS[run.format](run.filePath, run.content);
}

/** One run: report a failure through the host's slot, then always clear busy and close. */
async function executeRun(run: DownloadRun): Promise<void> {
  try {
    await saveFormat(run);
  } catch (error) {
    console.error(`[WorkspaceFileMenu] ${LOG_LABELS[run.format]} export failed`, error);
    run.onError?.(getDownloadFormat(run.format).failureMessage);
  } finally {
    run.onSettled();
    run.onRequestClose?.();
  }
}

/** Only DOCX/PDF have a busy label; Markdown runs without a progress state. */
function busyFormatFor(format: DownloadFormat): DownloadFormat | null {
  return getDownloadFormat(format).busyLabel ? format : null;
}

/** A run needs an enabled host, no run in flight, and loaded content (`''` counts). */
function isDownloadable(
  enabled: boolean,
  busy: boolean,
  content: string | null
): content is string {
  return enabled && !busy && content !== null;
}

/**
 * The only download dispatcher for file hosts. A synchronous ref guard keeps a second
 * click from starting a parallel run before `busyFormat` re-renders.
 */
export function useFileDownloadActions({
  filePath,
  content,
  enabled,
  onStart,
  onError,
  onRequestClose,
}: UseFileDownloadActionsArgs): {
  busyFormat: DownloadFormat | null;
  run: (format: DownloadFormat) => void;
} {
  const [busyFormat, setBusyFormat] = useState<DownloadFormat | null>(null);
  const busyRef = useRef(false);

  const run = useCallback(
    (format: DownloadFormat) => {
      if (!isDownloadable(enabled, busyRef.current, content)) return;
      busyRef.current = true;
      onStart?.();
      setBusyFormat(busyFormatFor(format));
      void executeRun({
        format,
        filePath,
        content,
        onError,
        onRequestClose,
        onSettled: () => {
          busyRef.current = false;
          setBusyFormat(null);
        },
      });
    },
    [enabled, content, filePath, onStart, onError, onRequestClose]
  );

  return { busyFormat, run };
}
