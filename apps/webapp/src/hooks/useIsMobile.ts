'use client';

import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(mql.matches);
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-initialize-state -- intentional: matchMedia is unavailable during SSR, so the initial value is false and synced to the real viewport after mount
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
