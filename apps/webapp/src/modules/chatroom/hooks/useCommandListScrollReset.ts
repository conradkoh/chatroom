'use client';

import { useEffect, useRef } from 'react';

/** Resets a scroll container to top whenever `query` changes (command dialog search). */
export function useCommandListScrollReset(query: string) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query]);
  return listRef;
}
