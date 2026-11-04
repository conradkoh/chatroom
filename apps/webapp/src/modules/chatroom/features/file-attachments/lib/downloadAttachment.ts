/**
 * Downloads a stored attachment's original bytes.
 *
 * Convex storage URLs are CORS-enabled for the webapp origin, so a plain
 * `fetch` returns the bytes. The blob is typed as `application/octet-stream` so
 * the browser always saves it instead of treating SVG/HTML as a document.
 * `downloadBlobFile` is the only place a `blob:` URL is created.
 */

import { downloadBlobFile } from '../../../lib/messageExport/downloadTextFile';

export async function downloadAttachment(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = new Blob([await res.arrayBuffer()], { type: 'application/octet-stream' });
  downloadBlobFile(filename, blob);
}
