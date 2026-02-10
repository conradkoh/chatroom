'use client';

/**
 * Prompts Context
 *
 * Pre-fetches and caches agent prompts for all team roles through Convex subscriptions.
 * Components can synchronously access prompts for any role without additional queries.
 *
 * IMPORTANT: We use a fixed set of ALL_KNOWN_ROLES to ensure the number of useQuery
 * hooks never changes between renders (React Rules of Hooks). Roles not in the current
 * team are skipped via `"skip"` argument.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import { useQuery } from 'convex/react';
import type { ReactNode } from 'react';
import React, { createContext, useContext, useMemo } from 'react';

interface PromptsContextValue {
  /**
   * Get the full agent prompt for a role.
   * Returns the cached prompt or undefined if not yet loaded.
   */
  getAgentPrompt: (role: string) => string | undefined;

  /**
   * Check if the current Convex URL is production.
   * Used to determine if env var overrides are needed.
   */
  isProductionUrl: boolean | undefined;

  /**
   * Check if all prompts are loaded.
   */
  isLoaded: boolean;
}

const PromptsContext = createContext<PromptsContextValue | null>(null);

/**
 * Fixed set of all known roles across all team types.
 * This ensures the number of useQuery hooks is always constant,
 * avoiding React's Rules of Hooks violation when switching teams.
 *
 * When adding a new role, add it here.
 */
const ALL_KNOWN_ROLES = ['planner', 'builder', 'reviewer'] as const;

interface PromptsProviderProps {
  children: ReactNode;
  chatroomId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
}

export function PromptsProvider({
  children,
  chatroomId,
  teamName,
  teamRoles,
  teamEntryPoint,
}: PromptsProviderProps) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  // Memoize a Set for O(1) lookups
  const activeRolesSet = useMemo(() => new Set(teamRoles.map((r) => r.toLowerCase())), [teamRoles]);

  // Check if URL is production
  const isProductionUrl = useQuery(api.prompts.webapp.checkIsProductionUrl, {
    convexUrl,
  });

  // Pre-fetch prompts using a FIXED set of hooks (one per known role).
  // Roles not in the current team are skipped via "skip".
  // This ensures the hook count never changes between renders.
  const promptSlot0 = useQuery(
    api.prompts.webapp.getAgentPrompt,
    activeRolesSet.has(ALL_KNOWN_ROLES[0])
      ? { chatroomId, role: ALL_KNOWN_ROLES[0], teamName, teamRoles, teamEntryPoint, convexUrl }
      : 'skip'
  );
  const promptSlot1 = useQuery(
    api.prompts.webapp.getAgentPrompt,
    activeRolesSet.has(ALL_KNOWN_ROLES[1])
      ? { chatroomId, role: ALL_KNOWN_ROLES[1], teamName, teamRoles, teamEntryPoint, convexUrl }
      : 'skip'
  );
  const promptSlot2 = useQuery(
    api.prompts.webapp.getAgentPrompt,
    activeRolesSet.has(ALL_KNOWN_ROLES[2])
      ? { chatroomId, role: ALL_KNOWN_ROLES[2], teamName, teamRoles, teamEntryPoint, convexUrl }
      : 'skip'
  );

  // Map each fixed slot back to its role
  const promptSlots = useMemo(
    () => [promptSlot0, promptSlot1, promptSlot2] as const,
    [promptSlot0, promptSlot1, promptSlot2]
  );

  // Build a map of role -> prompt
  const promptMap = useMemo(() => {
    const map = new Map<string, string>();
    ALL_KNOWN_ROLES.forEach((role, index) => {
      const prompt = promptSlots[index];
      if (prompt && activeRolesSet.has(role)) {
        map.set(role, prompt);
      }
    });
    return map;
  }, [promptSlots, activeRolesSet]);

  // Check if all active role prompts are loaded
  const isLoaded = useMemo(() => {
    if (isProductionUrl === undefined) return false;
    return ALL_KNOWN_ROLES.every((role, index) => {
      if (!activeRolesSet.has(role)) return true; // skipped roles are "loaded"
      return promptSlots[index] !== undefined;
    });
  }, [isProductionUrl, promptSlots, activeRolesSet]);

  const contextValue = useMemo<PromptsContextValue>(
    () => ({
      getAgentPrompt: (role: string) => {
        return promptMap.get(role.toLowerCase());
      },
      isProductionUrl,
      isLoaded,
    }),
    [promptMap, isProductionUrl, isLoaded]
  );

  return <PromptsContext.Provider value={contextValue}>{children}</PromptsContext.Provider>;
}

/**
 * Hook to access prompts from context.
 * Must be used within a PromptsProvider.
 */
export function usePrompts() {
  const context = useContext(PromptsContext);
  if (!context) {
    throw new Error('usePrompts must be used within PromptsProvider');
  }
  return context;
}
