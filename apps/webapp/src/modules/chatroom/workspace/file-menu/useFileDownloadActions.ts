import { useCallback, useSyncExternalStore } from 'react';

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

/**
 * In-flight runs keyed by workspace and file. Module scope on purpose: a menu that closes
 * mid-run unmounts its hook, and the busy state and the double-run guard must survive that.
 */
const inFlightFormats = new Map<string, DownloadFormat>();
const inFlightListeners = new Set<() => void>();

function downloadKey(workingDir: string | null, filePath: string): string {
  return `${workingDir ?? ''}\u0000${filePath}`;
}

function readInFlight(key: string): DownloadFormat | null {
  return inFlightFormats.get(key) ?? null;
}

function writeInFlight(key: string, format: DownloadFormat | null): void {
  if (format) inFlightFormats.set(key, format);
  else inFlightFormats.delete(key);
  for (const listener of inFlightListeners) listener();
}

function subscribeInFlight(listener: () => void): () => void {
  inFlightListeners.add(listener);
  return () => {
    inFlightListeners.delete(listener);
  };
}

export interface UseFileDownloadActionsArgs {
  filePath: string;
  /** Workspace the file belongs to; part of the in-flight key. `null` when the host has none. */
  workingDir: string | null;
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
  /** Releases the in-flight entry and clears the busy row. */
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

/** A run needs an enabled host, no run in flight, and loaded content (`''` counts). */
function isDownloadable(
  enabled: boolean,
  busy: boolean,
  content: string | null
): content is string {
  return enabled && !busy && content !== null;
}

/**
 * The only download dispatcher for file hosts. The in-flight map is the guard: it is read
 * before a run starts, so a second click cannot start a parallel run, and it outlives the
 * hook so a menu that closes and reopens mid-run still shows the busy row.
 */
export function useFileDownloadActions({
  filePath,
  workingDir,
  content,
  enabled,
  onStart,
  onError,
  onRequestClose,
}: UseFileDownloadActionsArgs): {
  busyFormat: DownloadFormat | null;
  run: (format: DownloadFormat) => void;
} {
  const key = downloadKey(workingDir, filePath);
  // Any in-flight run disables every row. Only DOCX and PDF carry a busy label; the row
  // render checks `busyLabel`, so Markdown shows no progress text.
  const busyFormat = useSyncExternalStore(
    subscribeInFlight,
    () => readInFlight(key),
    () => null
  );

  const run = useCallback(
    (format: DownloadFormat) => {
      // Reads the map, not the rendered snapshot, so a second click before re-render is refused.
      if (!isDownloadable(enabled, readInFlight(key) !== null, content)) return;
      writeInFlight(key, format);
      onStart?.();
      void executeRun({
        format,
        filePath,
        content,
        onError,
        onRequestClose,
        onSettled: () => writeInFlight(key, null),
      });
    },
    [enabled, content, filePath, key, onStart, onError, onRequestClose]
  );

  return { busyFormat, run };
}
