'use client';

import { useSyncExternalStore } from 'react';

import { decompressGzip } from '../utils/decompressGzip';

type Entry = { status: 'loading' } | { status: 'ready'; value: string } | { status: 'error' };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
function emit() {
  for (const listener of listeners) listener();
}
function ensureDecompress(key: string) {
  if (cache.has(key)) return;
  cache.set(key, { status: 'loading' });
  decompressGzip(key)
    .then((value) => {
      cache.set(key, { status: 'ready', value });
      emit();
    })
    .catch(() => {
      cache.set(key, { status: 'error' });
      emit();
    });
}
function snapshot(payload: string | null | undefined, enabled: boolean) {
  if (!enabled || payload === undefined) return undefined;
  if (payload === null) return null;
  ensureDecompress(payload);
  const entry = cache.get(payload);
  return !entry || entry.status === 'loading'
    ? undefined
    : entry.status === 'error'
      ? null
      : entry.value;
}
export function useAsyncGzipDecompress(payload: string | null | undefined, enabled: boolean) {
  return useSyncExternalStore(
    subscribe,
    () => snapshot(payload, enabled),
    () => undefined
  );
}
