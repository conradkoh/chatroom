'use client';

/**
 * Prompts Context
 *
 * Pre-fetches and caches agent prompts for all team roles through Convex subscriptions.
 * Components can synchronously access prompts for any role without additional queries.
 *
 * Uses a single `getTeamPrompts` backend query that returns all role prompts in one call,
 * avoiding React Rules of Hooks issues when the team (and number of roles) changes.
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

  // Check if URL is production
  const isProductionUrl = useQuery(api.prompts.webapp.checkIsProductionUrl, {
    convexUrl,
  });

  // Single query to fetch all team prompts at once.
  // Returns Record<string, string> mapping role -> prompt.
  // This avoids calling useQuery in a loop (which violates React Rules of Hooks
  // when teamRoles changes size, e.g. pair→squad).
  const teamPrompts = useQuery(api.prompts.webapp.getTeamPrompts, {
    chatroomId,
    teamName,
    teamRoles,
    teamEntryPoint,
    convexUrl,
  });

  // Build a map of role -> prompt from the backend response
  const promptMap = useMemo(() => {
    const map = new Map<string, string>();
    if (teamPrompts) {
      for (const [role, prompt] of Object.entries(teamPrompts)) {
        map.set(role.toLowerCase(), prompt);
      }
    }
    return map;
  }, [teamPrompts]);

  // Check if all prompts are loaded
  const isLoaded = useMemo(() => {
    return isProductionUrl !== undefined && teamPrompts !== undefined;
  }, [isProductionUrl, teamPrompts]);

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
