/**
 * One in-flight download at a time, keyed by attachment id.
 *
 * The id drives the spinner in the row's Download button; failures surface as a
 * toast and leave the button idle so the user can retry.
 */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { downloadAttachment } from '../lib/downloadAttachment';

export function useAttachmentDownload(): {
  downloadingId: string | null;
  download: (id: string, url: string, filename: string) => Promise<void>;
} {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const download = useCallback(async (id: string, url: string, filename: string) => {
    setDownloadingId(id);
    try {
      await downloadAttachment(url, filename);
    } catch {
      toast.error(`Couldn't download ${filename}. Try again.`);
    } finally {
      setDownloadingId(null);
    }
  }, []);

  return { downloadingId, download };
}
