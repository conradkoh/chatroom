'use client';

import { useCallback, useEffect, useState } from 'react';

import type { EnhancerDiffViewMode } from '../types/enhancerDiff';

import { useIsDesktop } from '@/hooks/useIsDesktop';

function defaultViewMode(isDesktop: boolean): EnhancerDiffViewMode {
  return isDesktop ? 'split' : 'unified';
}

/**
 * Manages enhancer diff view mode with mobile-first defaults.
 * Mobile defaults to unified; desktop defaults to split. User toggle overrides until reset.
 */
export function useEnhancerDiffViewMode() {
  const isDesktop = useIsDesktop();
  const [viewMode, setViewMode] = useState<EnhancerDiffViewMode>(() => defaultViewMode(isDesktop));
  const [hasUserOverride, setHasUserOverride] = useState(false);

  useEffect(() => {
    if (!hasUserOverride) {
      setViewMode(defaultViewMode(isDesktop));
    }
  }, [isDesktop, hasUserOverride]);

  const setViewModeWithOverride = useCallback((mode: EnhancerDiffViewMode) => {
    setHasUserOverride(true);
    setViewMode(mode);
  }, []);

  const resetViewMode = useCallback(() => {
    setHasUserOverride(false);
    setViewMode(defaultViewMode(isDesktop));
  }, [isDesktop]);

  return {
    viewMode,
    setViewMode: setViewModeWithOverride,
    resetViewMode,
    isDesktop,
  };
}
