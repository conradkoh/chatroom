/**
 * useCommandRanking — provides frécency-boosted filtering for the command palette.
 *
 * Combines fuzzy matching with usage-based ranking.
 * Tracks command selections and computes scores.
 */

'use client';

import { useCallback, useMemo } from 'react';
import { fuzzyFilter } from '@/lib/fuzzyMatch';
import { getCommandUsageStore } from '../lib/commandUsageStore';
import { computeAllFrecencyScores, createRankedFilter } from '../lib/frecencyScoring';

/**
 * Hook that provides:
 * - A ranked filter function for cmdk (combines fuzzy + frécency)
 * - A trackUsage callback to record command selections
 */
export function useCommandRanking() {
  const store = useMemo(() => getCommandUsageStore(), []);

  // Compute frécency scores from all tracked usage
  const frecencyScores = useMemo(() => {
    const usage = store.getAllUsage();
    return computeAllFrecencyScores(usage);
  }, [store]);

  // Create the ranked filter that combines fuzzy matching with frécency
  const rankedFilter = useMemo(
    () => createRankedFilter(fuzzyFilter, frecencyScores),
    [frecencyScores]
  );

  // Track when a command is selected
  const trackUsage = useCallback(
    (commandLabel: string) => {
      store.recordUsage(commandLabel);
    },
    [store]
  );

  return {
    /** cmdk-compatible filter function with frécency boosting */
    rankedFilter,
    /** Record that a command was selected (call in handleSelect) */
    trackUsage,
    /** Current frécency scores (for UI indicators) */
    frecencyScores,
  };
}
