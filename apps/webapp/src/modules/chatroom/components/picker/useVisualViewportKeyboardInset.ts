'use client';

import { useEffect, useState } from 'react';

export function computeKeyboardInsetPx(): number {
  if (typeof window === 'undefined') return 0;
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

export function useVisualViewportKeyboardInset(): number {
  const [insetPx, setInsetPx] = useState(0);

  useEffect(() => {
    const update = () => setInsetPx(computeKeyboardInsetPx());
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  return insetPx;
}
