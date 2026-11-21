/**
 * One download state per consumer, keyed by attachment id.
 *
 * `downloadingId` drives the row spinner. A failure stays in `downloadError` until
 * the next download starts, the user dismisses it, or the consumer unmounts. The
 * button returns to idle as soon as the attempt ends, success or failure.
 */

import { useCallback, useState } from 'react';

import { downloadAttachment } from '../lib/downloadAttachment';

import type { Feedback } from '@/components/inline-feedback';

export interface AttachmentDownloadError {
  /** Attachment id of the download that failed. */
  id: string;
  message: string;
}

export function useAttachmentDownload(): {
  downloadingId: string | null;
  downloadError: AttachmentDownloadError | null;
  download: (id: string, url: string, filename: string) => Promise<void>;
  clearDownloadError: () => void;
} {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<AttachmentDownloadError | null>(null);

  const clearDownloadError = useCallback(() => setDownloadError(null), []);

  const download = useCallback(async (id: string, url: string, filename: string) => {
    setDownloadingId(id);
    setDownloadError(null);
    try {
      await downloadAttachment(url, filename);
    } catch {
      setDownloadError({ id, message: `Couldn't download ${filename}. Try again.` });
    } finally {
      setDownloadingId(null);
    }
  }, []);

  return { downloadingId, downloadError, download, clearDownloadError };
}

/**
 * Maps a download failure to the `InlineFeedback` shape. The id is constant: a
 * failure only appears after a clear (the next download clears first), so the
 * node mounts fresh and the alert is announced again.
 */
export function downloadErrorFeedback(error: AttachmentDownloadError | null): Feedback | null {
  return error ? { id: 1, tone: 'error', message: error.message } : null;
}
