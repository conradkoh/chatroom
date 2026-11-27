/**
 * Streaming download adapter for an ephemeral machine-backup copy.
 *
 * No DOM, no Convex, no store: the caller passes the short-lived storage URL, which is never
 * stored or logged. The body is read chunk by chunk so progress can be shown, and the received
 * byte count is checked against the row's expected size before the blob is handed back. A shorter
 * or longer body fails with `size_mismatch`; `Content-Length` is not trusted.
 */

export type BackupStreamFailure = 'http' | 'size_mismatch' | 'aborted' | 'network';

export interface DownloadBackupStreamArgs {
  /** Short-lived storage URL from `createDownloadAccess`. Never stored or logged. */
  url: string;
  expectedBytes: number;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (received: number) => void;
}

export type DownloadBackupStreamResult =
  { ok: true; blob: Blob } | { ok: false; reason: BackupStreamFailure; received: number };

/** True when a thrown value is an abort (the `AbortError` DOMException or an aborted signal). */
// fallow-ignore-next-line complexity
function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  return typeof error === 'object' && error !== null && 'name' in error
    ? (error as { name?: unknown }).name === 'AbortError'
    : false;
}

/** Reads every chunk of the response body, summing the received bytes and reporting progress. */
// fallow-ignore-next-line complexity
async function readBody(
  body: ReadableStream<Uint8Array>,
  onProgress: ((received: number) => void) | undefined
): Promise<{ received: number; parts: Uint8Array[] }> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    parts.push(value);
    received += value.byteLength;
    onProgress?.(received);
  }

  return { received, parts };
}

// fallow-ignore-next-line complexity
export async function downloadBackupStream(
  args: DownloadBackupStreamArgs
): Promise<DownloadBackupStreamResult> {
  const fetchFn = args.fetchFn ?? fetch;
  let response: Response;

  try {
    response = await fetchFn(args.url, { signal: args.signal });
  } catch (error) {
    return {
      ok: false,
      reason: isAbort(error, args.signal) ? 'aborted' : 'network',
      received: 0,
    };
  }

  if (!response.ok) return { ok: false, reason: 'http', received: 0 };
  if (!response.body) return { ok: false, reason: 'network', received: 0 };

  let received = 0;
  try {
    const body = await readBody(response.body, args.onProgress);
    received = body.received;
    if (received !== args.expectedBytes) {
      return { ok: false, reason: 'size_mismatch', received };
    }
    return { ok: true, blob: new Blob(body.parts as BlobPart[]) };
  } catch (error) {
    return {
      ok: false,
      reason: isAbort(error, args.signal) ? 'aborted' : 'network',
      received,
    };
  }
}
