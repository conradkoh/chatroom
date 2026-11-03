/**
 * Loads a text or markdown attachment for the preview dialog.
 *
 * Truncation is by bytes, not characters: UTF-8 text can be several bytes per
 * character, and the cap must bound memory regardless of script. Decoding a
 * byte slice can split a multi-byte sequence at the edge, which `TextDecoder`
 * replaces with U+FFFD — acceptable for a preview that says it is truncated.
 */

import { useCallback, useEffect, useState } from 'react';

export const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;

export type FileTextState =
  | { status: 'idle' | 'loading' | 'error'; retry: () => void }
  | { status: 'ready'; text: string; truncated: boolean; retry: () => void };

type FileTextSnapshot =
  { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; text: string; truncated: boolean };

async function loadTextPreview(url: string, signal: AbortSignal): Promise<FileTextSnapshot> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const truncated = buf.byteLength > TEXT_PREVIEW_MAX_BYTES;
    const text = new TextDecoder().decode(buf.slice(0, TEXT_PREVIEW_MAX_BYTES));
    return { status: 'ready', text, truncated };
  } catch {
    return { status: 'error' };
  }
}

export function useFileTextContent(url: string | null, enabled: boolean): FileTextState {
  const [retryCount, setRetryCount] = useState(0);
  const [state, setState] = useState<FileTextSnapshot>({ status: 'idle' });
  const retry = useCallback(() => setRetryCount((count) => count + 1), []);

  useEffect(() => {
    if (!enabled || !url) {
      setState({ status: 'idle' });
      return undefined;
    }

    const controller = new AbortController();
    setState({ status: 'loading' });
    void loadTextPreview(url, controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next);
    });

    return () => controller.abort();
  }, [url, enabled, retryCount]);

  return { ...state, retry };
}
