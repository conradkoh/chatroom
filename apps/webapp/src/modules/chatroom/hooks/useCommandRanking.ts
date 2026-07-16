/**
 * useCommandRanking — provides frécency-boosted filtering for the command palette.
 *
 * Combines fuzzy matching with usage-based ranking.
 * Tracks command selections and computes scores.
 * Scores refresh immediately after trackUsage (usageVersion pattern).
 */

'use client';

import { useCallback, useMemo, useState } from 'react';

import type { CommandItem } from '../components/CommandPalette/types';
import { getCommandFrecencyKey, resolveFrecencyKeyFromLabel } from '../lib/commandFrecencyKey';
import { getCommandUsageStore } from '../lib/commandUsageStore';
import { computeAllFrecencyScores, createRankedFilter } from '../lib/frecencyScoring';

import { fuzzyFilter } from '@/lib/fuzzyMatch';

/**
 * Hook that provides:
 * - A ranked filter function for cmdk (combines fuzzy + frécency)
 * - A trackUsage callback to record command selections
 * - getScore helper for per-command score lookup
 */
export function useCommandRanking(commands: CommandItem[]) {
  const store = useMemo(() => getCommandUsageStore(), []);

  // Bump to force score recompute after trackUsage
  const [usageVersion, setUsageVersion] = useState(0);

  // Build label → frecency key map once per commands change
  const labelToFrecencyKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const cmd of commands) {
      map.set(cmd.label, getCommandFrecencyKey(cmd));
    }
    return map;
  }, [commands]);

  // Compute frécency scores from all tracked usage
  const frecencyScores = useMemo(() => {
    void usageVersion; // depend on usageVersion so trackUsage invalidates this
    const usage = store.getAllUsage();
    return computeAllFrecencyScores(usage);
  }, [store, usageVersion]);

  // Create the ranked filter that resolves cmdk label → frecency key
  const rankedFilter = useMemo(
    () =>
      createRankedFilter(fuzzyFilter, frecencyScores, (label) =>
        resolveFrecencyKeyFromLabel(label, labelToFrecencyKey)
      ),
    [frecencyScores, labelToFrecencyKey]
  );

  // Track when a command is selected — uses stable frecency key
  const trackUsage = useCallback(
    (command: CommandItem) => {
      store.recordUsage(getCommandFrecencyKey(command));
      setUsageVersion((v) => v + 1);
    },
    [store]
  );

  // Per-command score lookup (never use command.label directly)
  const getScore = useCallback(
    (command: CommandItem) => frecencyScores.get(getCommandFrecencyKey(command)) ?? 0,
    [frecencyScores]
  );

  return {
    /** cmdk-compatible filter function with frécency boosting */
    rankedFilter,
    /** Record that a command was selected (call in handleSelect) */
    trackUsage,
    /** Current frécency scores (for UI indicators) */
    frecencyScores,
    /** Per-command score lookup */
    getScore,
  };
}
