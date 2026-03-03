'use client';

/**
 * Prompts Context
 *
 * Pre-generates and caches agent prompts for all team roles synchronously.
 * Prompt generation runs entirely on the frontend using the shared prompt
 * generation library — no API calls required.
 *
 * Previously prompts were fetched via Convex queries (getTeamPrompts,
 * checkIsProductionUrl). Moving generation to the frontend eliminates
 * 1 API call per role per chatroom visit.
 */

import {
  generateAgentPrompt,
} from '@workspace/backend/prompts/base/webapp';
import type { ReactNode } from 'react';
import React, { createContext, useContext, useMemo } from 'react';

interface PromptsContextValue {
  /**
   * Get the full agent prompt for a role.
   * Returns the generated prompt string (synchronous — always available).
   */
  getAgentPrompt: (role: string) => string | undefined;

  /**
   * Check if all prompts are loaded.
   * Always true since generation is synchronous.
   */
  isLoaded: boolean;
}

const PromptsContext = createContext<PromptsContextValue | null>(null);

interface PromptsProviderProps {
  children: ReactNode;
  chatroomId: string;
  teamId?: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
}

export function PromptsProvider({
  children,
  chatroomId,
  teamId,
  teamName,
  teamRoles,
  teamEntryPoint,
}: PromptsProviderProps) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  // Generate all prompts synchronously — no API call needed
  const promptMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const role of teamRoles) {
      map.set(
        role.toLowerCase(),
        generateAgentPrompt({
          chatroomId,
          role,
          teamId,
          teamName,
          teamRoles,
          teamEntryPoint,
          convexUrl,
        })
      );
    }
    return map;
  }, [chatroomId, teamId, teamName, teamRoles, teamEntryPoint, convexUrl]);

  const contextValue = useMemo<PromptsContextValue>(
    () => ({
      getAgentPrompt: (role: string) => promptMap.get(role.toLowerCase()),
      isLoaded: true, // Always loaded — generation is synchronous
    }),
    [promptMap]
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
