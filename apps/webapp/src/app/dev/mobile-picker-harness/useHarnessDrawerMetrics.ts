'use client';

import { useCallback, useEffect, useState } from 'react';

import { type DrawerMetrics, readDrawerMetrics } from './readDrawerMetrics';

export function useHarnessDrawerMetrics(
  flatOpen: boolean,
  filterOpen: boolean,
  keyboardInset: number,
  flatSearch: string,
  filterSearch: string
) {
  const [metrics, setMetrics] = useState<DrawerMetrics | null>(null);

  const refreshMetrics = useCallback(() => {
    setMetrics(readDrawerMetrics());
  }, []);

  useEffect(() => {
    window.__PICKER_TEST_KEYBOARD_INSET__ = keyboardInset;
    window.dispatchEvent(new Event('resize'));
    refreshMetrics();
  }, [keyboardInset, refreshMetrics]);

  useEffect(() => {
    if (!flatOpen && !filterOpen) {
      setMetrics(null);
      return;
    }
    const id = window.requestAnimationFrame(refreshMetrics);
    return () => window.cancelAnimationFrame(id);
  }, [flatOpen, filterOpen, flatSearch, filterSearch, keyboardInset, refreshMetrics]);

  return metrics;
}
