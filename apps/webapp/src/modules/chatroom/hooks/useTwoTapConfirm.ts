import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Two-tap confirmation hook. First call to `request(key)` arms confirmation
 * for that key. A second call with the same key within `timeoutMs` invokes
 * `onConfirm(key)`. After `timeoutMs` with no second tap, the armed state
 * auto-clears. Calling `request(key)` with a different key resets the timer.
 *
 * @returns `{ armedKey, request, reset }` — `armedKey` is the currently armed
 * key (undefined if none); `request(key)` advances the state machine;
 * `reset()` clears any armed state immediately.
 */
export function useTwoTapConfirm<TKey>(
  onConfirm: (key: TKey) => void | Promise<void>,
  timeoutMs = 3000
) {
  const [armedKey, setArmedKey] = useState<TKey | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setArmedKey(undefined);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => reset(), [reset]);

  const request = useCallback(
    (key: TKey) => {
      if (armedKey !== undefined && Object.is(armedKey, key)) {
        reset();
        return onConfirm(key);
      }
      setArmedKey(key);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setArmedKey(undefined), timeoutMs);
    },
    [armedKey, onConfirm, reset, timeoutMs]
  );

  return { armedKey, request, reset };
}
