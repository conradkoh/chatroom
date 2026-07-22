import { useCallback, useEffect, useRef, useState } from 'react';
import { isScrollAtBottom } from './isScrollAtBottom';
import { isScrollAtTop } from './isScrollAtTop';

export function useStickToBottomScroll(itemCount: number, resetKey?: string) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isPinned, setIsPinned] = useState(true);
  const [hasUnseenBelow, setHasUnseenBelow] = useState(false);
  const [isAtTop, setIsAtTop] = useState(true);
  const prevCountRef = useRef(itemCount);

  useEffect(() => {
    setIsPinned(true);
    setHasUnseenBelow(false);
    setIsAtTop(true);
    prevCountRef.current = itemCount;
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToEnd = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setIsPinned(true);
    setHasUnseenBelow(false);
  }, []);

  const scrollToTop = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior });
    setIsAtTop(true);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = isScrollAtBottom(el);
    const atTop = isScrollAtTop(el);
    setIsPinned(atBottom);
    setIsAtTop(atTop);
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
    isAtTop,
    scrollToEnd,
    scrollToTop,
    handleScroll,
    jumpToNew: () => scrollToEnd('smooth'),
    jumpToTop: () => scrollToTop('smooth'),
  };
}
