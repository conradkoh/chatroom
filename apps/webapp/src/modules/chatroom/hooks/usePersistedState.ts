'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Options for {@link usePersistedState}.
 *
 * All serialization uses `JSON.stringify` / `JSON.parse`. For backward
 * compatibility, a raw string stored without JSON encoding is also accepted
 * and returned as-is.
 */
interface UsePersistedStateOptions<T> {
  /**
   * Type guard called on the deserialized value. If it returns `false`, the
   * hook falls back to `defaultValue`. Useful for constraining union types
   * at runtime (e.g. `ActivityView` or `ExplorerSplitPanelMode`).
   */
  validate?: (v: unknown) => v is T;
}

/**
 * Reads a value from localStorage, with graceful fallback.
 */
function readPersistedValue<T>(key: string, defaultValue: T, validate?: (v: unknown) => v is T): T {
  if (typeof window === 'undefined') return defaultValue;

  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      // Not JSON-encoded — backward compatibility with plain strings
      parsed = stored;
    }

    if (validate) {
      return validate(parsed) ? parsed : defaultValue;
    }

    return parsed as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Writes a value to localStorage.
 */
function writePersistedValue<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore write failures (private browsing, quota exceeded, etc.)
  }
}

/**
 * Generic localStorage-backed state hook.
 *
 * Behaves like `useState`, but the value is persisted in `localStorage` under
 * `key`. When `key` changes (e.g. navigating between chatrooms), the value is
 * re-synchronised from storage.
 *
 * @param key          localStorage key (should be stable per chatroom context).
 * @param defaultValue Fallback value used when nothing is stored or storage is
 *                     unavailable.
 * @param options      Optional `validate` type guard to constrain runtime values.
 *
 * @returns A tuple `[value, setValue]` identical in shape to `useState`.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  options?: UsePersistedStateOptions<T>
): [T, (value: T) => void] {
  const [state, setState] = useState<T>(() =>
    readPersistedValue(key, defaultValue, options?.validate)
  );

  // Re-sync when the key changes (navigating between chatrooms).
  useEffect(() => {
    setState(readPersistedValue(key, defaultValue, options?.validate));
  }, [key]);

  const setValue = useCallback(
    (next: T) => {
      writePersistedValue(key, next);
      setState(next);
    },
    [key]
  );

  return [state, setValue];
}
