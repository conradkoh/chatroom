'use client';

import { useCallback, useEffect, useState } from 'react';

import { type DrawerMetrics, readDrawerMetrics } from './readDrawerMetrics';

export function useHarnessDrawerMetrics(
  flatOpen: boolean,
  filterOpen: boolean,
  keyboardInset: number,
  viewportOffsetTop: number,
  flatSearch: string,
  filterSearch: string
) {
  const [metrics, setMetrics] = useState<DrawerMetrics | null>(null);

  const refreshMetrics = useCallback(() => {
    setMetrics(readDrawerMetrics());
  }, []);

  useEffect(() => {
    window.__MOBILE_KEYBOARD_TEST_INSET__ = keyboardInset;
    window.__MOBILE_KEYBOARD_TEST_OFFSET_TOP__ = viewportOffsetTop;
    window.dispatchEvent(new Event('resize'));
    refreshMetrics();
  }, [keyboardInset, viewportOffsetTop, refreshMetrics]);

  useEffect(() => {
    return () => {
      delete window.__MOBILE_KEYBOARD_TEST_INSET__;
      delete window.__MOBILE_KEYBOARD_TEST_OFFSET_TOP__;
    };
  }, []);

  useEffect(() => {
    if (!flatOpen && !filterOpen) {
      setMetrics(null);
      return;
    }
    const id = window.requestAnimationFrame(refreshMetrics);
    return () => window.cancelAnimationFrame(id);
  }, [
    flatOpen,
    filterOpen,
    flatSearch,
    filterSearch,
    keyboardInset,
    viewportOffsetTop,
    refreshMetrics,
  ]);

  return metrics;
}
