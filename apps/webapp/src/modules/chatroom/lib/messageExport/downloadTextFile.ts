import type { Message } from '../../types/message';

export type SaveFileResult = 'saved' | 'downloaded' | 'cancelled';

export type SaveFileOptions = {
  mimeType: string;
  extensions: string[];
  description?: string;
};

export type SaveFileHandleResult =
  | { kind: 'handle'; handle: FileSystemFileHandle }
  | { kind: 'anchor' }
  | { kind: 'cancelled' };

// Minimal DOM declarations for showSaveFilePicker if not in TS libs
type SaveFilePickerAcceptType = {
  description?: string;
  accept: Record<string, string[]>;
};
type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: SaveFilePickerAcceptType[];
};
interface SaveFilePickerWindow {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}

function canUseSaveFilePicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as SaveFilePickerWindow).showSaveFilePicker === 'function'
  );
}

function downloadBlobViaAnchor(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Legacy sync download — prefer `saveBlobFile` for user-facing saves. */
export function downloadBlobFile(filename: string, blob: Blob): void {
  downloadBlobViaAnchor(filename, blob);
}

/**
 * Opens a native save dialog when supported; otherwise falls back to anchor download.
 * For slow content (DOCX), call `promptSaveFile` first, generate, then `writeBlobToHandle`.
 */
export async function saveBlobFile(
  suggestedName: string,
  blob: Blob,
  options: SaveFileOptions
): Promise<SaveFileResult> {
  if (!canUseSaveFilePicker()) {
    downloadBlobViaAnchor(suggestedName, blob);
    return 'downloaded';
  }

  try {
    const handle = await (window as SaveFilePickerWindow).showSaveFilePicker!({
      suggestedName,
      types: [
        {
          description: options.description ?? 'File',
          accept: { [options.mimeType]: options.extensions },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return 'saved';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return 'cancelled';
    }
    downloadBlobViaAnchor(suggestedName, blob);
    return 'downloaded';
  }
}

/** Call FIRST (user gesture) before slow generation. */
export async function promptSaveFile(
  suggestedName: string,
  options: SaveFileOptions
): Promise<SaveFileHandleResult> {
  if (!canUseSaveFilePicker()) {
    return { kind: 'anchor' };
  }
  try {
    const handle = await (window as SaveFilePickerWindow).showSaveFilePicker!({
      suggestedName,
      types: [
        {
          description: options.description ?? 'File',
          accept: { [options.mimeType]: options.extensions },
        },
      ],
    });
    return { kind: 'handle', handle };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { kind: 'cancelled' };
    }
    return { kind: 'anchor' };
  }
}

export async function writeBlobToSaveTarget(
  target: SaveFileHandleResult,
  suggestedName: string,
  blob: Blob
): Promise<SaveFileResult> {
  if (target.kind === 'cancelled') return 'cancelled';
  if (target.kind === 'anchor') {
    downloadBlobViaAnchor(suggestedName, blob);
    return 'downloaded';
  }
  const writable = await target.handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return 'saved';
}

export async function saveTextFile(
  filename: string,
  content: string,
  mimeType: string,
  extensions: string[]
): Promise<SaveFileResult> {
  const blob = new Blob([content], { type: mimeType });
  return saveBlobFile(filename, blob, {
    mimeType,
    extensions,
    description: mimeType === 'text/markdown' ? 'Markdown' : 'File',
  });
}

/** @deprecated Prefer saveTextFile — kept for backward compatibility. */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlobViaAnchor(filename, blob);
}

export function messageExportFilename(message: Message, ext: string): string {
  const role = message.senderRole ?? 'message';
  const ts = new Date(message._creationTime).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `chatroom-${role}-${ts}.${ext}`;
}
