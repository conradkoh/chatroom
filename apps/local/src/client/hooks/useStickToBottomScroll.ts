import { useCallback, useEffect, useRef, useState } from 'react';
import { isScrollAtBottom } from './isScrollAtBottom';

export function useStickToBottomScroll(itemCount: number, resetKey?: string) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isPinned, setIsPinned] = useState(true);
  const [hasUnseenBelow, setHasUnseenBelow] = useState(false);
  const prevCountRef = useRef(itemCount);

  useEffect(() => {
    setIsPinned(true);
    setHasUnseenBelow(false);
    prevCountRef.current = itemCount;
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToEnd = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setIsPinned(true);
    setHasUnseenBelow(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = isScrollAtBottom(el);
    setIsPinned(atBottom);
    if (atBottom) setHasUnseenBelow(false);
  }, []);

  useEffect(() => {
    if (itemCount > prevCountRef.current && !isPinned) {
      setHasUnseenBelow(true);
    }
    prevCountRef.current = itemCount;
  }, [itemCount, isPinned]);

  return {
    scrollRef,
    isPinned,
    hasUnseenBelow,
    scrollToEnd,
    handleScroll,
    jumpToNew: () => scrollToEnd('smooth'),
  };
}
