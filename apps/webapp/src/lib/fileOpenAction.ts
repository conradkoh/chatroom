import type { FilePreviewKind } from '@workspace/shared/domain/file-attachment';

/** Preview kind plus the terminal state for deleted or expired files. */
export type FileOpenKind = FilePreviewKind | 'unavailable';

/** What the primary click on a file row does. */
export type FileOpenAction = 'open-pdf' | 'download' | 'preview';

/** Handlers the row supplies for the actions that need application state. */
export interface FileOpenHandlers {
  download: () => void;
  preview: () => void;
}

/**
 * The one open rule for every file view: pdfs open in a new tab, kinds with no
 * inline preview download, and everything else previews.
 */
export function fileOpenAction(kind: FileOpenKind): FileOpenAction {
  if (kind === 'pdf') return 'open-pdf';
  if (kind === 'download') return 'download';
  return 'preview';
}

/**
 * Builds the row's primary click. A missing url makes the row non-interactive,
 * matching the loading and unavailable states.
 */
export function performFileOpen(
  action: FileOpenAction,
  url: string | null,
  handlers: FileOpenHandlers
): (() => void) | undefined {
  if (!url) return undefined;
  if (action === 'open-pdf') return () => window.open(url, '_blank', 'noopener,noreferrer');
  if (action === 'download') return handlers.download;
  return handlers.preview;
}
