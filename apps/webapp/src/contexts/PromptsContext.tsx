'use client';

/**
 * Prompts Context
 *
 * Pre-fetches and caches agent prompts for all team roles through Convex subscriptions.
 * Components can synchronously access prompts for any role without additional queries.
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

  // Pre-fetch prompts for all team roles
  // Each useQuery call creates a subscription that stays up-to-date
  const promptQueries = teamRoles.map((role) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useQuery(api.prompts.webapp.getAgentPrompt, {
      chatroomId,
      role,
      teamName,
      teamRoles,
      teamEntryPoint,
      convexUrl,
    });
  });

  // Build a map of role -> prompt
  const promptMap = useMemo(() => {
    const map = new Map<string, string>();
    teamRoles.forEach((role, index) => {
      const prompt = promptQueries[index];
      if (prompt) {
        map.set(role.toLowerCase(), prompt);
      }
    });
    return map;
  }, [teamRoles, promptQueries]);

  // Check if all prompts are loaded
  const isLoaded = useMemo(() => {
    return isProductionUrl !== undefined && promptQueries.every((prompt) => prompt !== undefined);
  }, [isProductionUrl, promptQueries]);

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
