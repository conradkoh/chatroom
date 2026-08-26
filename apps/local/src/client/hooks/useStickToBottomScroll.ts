import { useCallback, useRef, useState } from 'react';

import { isScrollAtBottom } from './isScrollAtBottom';
import { isScrollAtTop } from './isScrollAtTop';

export function useStickToBottomScroll(itemCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isPinned, setIsPinned] = useState(true);
  const [isAtTop, setIsAtTop] = useState(true);
  const lastSeenCountRef = useRef(itemCount);

  const scrollToEnd = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      setIsPinned(true);
      lastSeenCountRef.current = itemCount;
    },
    [itemCount]
  );

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
    if (atBottom) lastSeenCountRef.current = itemCount;
  }, [itemCount]);

  const hasUnseenBelow = !isPinned && itemCount > lastSeenCountRef.current;

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
