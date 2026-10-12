// fallow-ignore-file unused-file
// Unused until slice 5b wires it into the WorkspaceService. Remove this line when it is wired.
import { normalizeWorkingDirForLookup } from '../../../../infrastructure/services/workspace/normalize-working-dir.js';
import type { AgentWorkspacePresence } from '../../agent-process-service/domain/entities/agent-process.js';

/** `active`: at least one live agent runs in the directory, so the monitor syncs. `idle`: no automatic sync. */
export type WorkspaceActivity = 'active' | 'idle';

/**
 * Normalized workingDirs that have at least one present agent.
 *
 * Pure: the result depends only on `presences`. Nothing is cached between calls, so the caller
 * re-derives the set each time it needs it.
 */
export function activeWorkingDirs(
  presences: readonly AgentWorkspacePresence[]
): ReadonlySet<string> {
  return new Set(presences.map((presence) => normalizeWorkingDirForLookup(presence.workingDir)));
}

/**
 * Normalizes and dedupes `next`, then returns the keys to add and remove relative to `current`.
 *
 * `current` holds keys already normalized by this function. The result is relative to those keys.
 */
export function diffMembership(
  current: Iterable<string>,
  next: readonly string[]
): { added: string[]; removed: string[] } {
  const nextKeys = new Set(next.map((dir) => normalizeWorkingDirForLookup(dir)));
  const currentKeys = new Set(current);
  return {
    added: [...nextKeys].filter((key) => !currentKeys.has(key)),
    removed: [...currentKeys].filter((key) => !nextKeys.has(key)),
  };
}
