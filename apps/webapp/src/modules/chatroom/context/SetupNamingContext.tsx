'use client';

/**
 * SETUP NAMING CONTEXT
 *
 * During first-time chatroom setup, pasting a project path into the entry-point
 * agent's working-directory field auto-names the chatroom from the final path
 * segment. Rather than drilling `onWorkingDirPasted` + a per-role autofocus flag
 * through InlineAgentCard → AgentControlsSection → RemoteTabContent, the setup
 * checklist provides them here and RemoteTabContent consumes them directly.
 *
 * RemoteTabContent is ALSO rendered outside setup (Agent Settings / All Agents),
 * where there is no provider — so `useSetupNaming` returns inert defaults
 * (no paste handler, no entry-point role → no autofocus) instead of throwing.
 */

import { createContext, useContext, type ReactNode } from 'react';

interface SetupNamingContextValue {
  /** Called when the user pastes a path into an agent's working-directory field. */
  onWorkingDirPasted?: (rawPath: string) => void;
  /** Role of the entry-point agent — its working-dir input gets autofocus during setup. */
  entryPointRole?: string;
}

const SetupNamingContext = createContext<SetupNamingContextValue | null>(null);

export function SetupNamingProvider({
  onWorkingDirPasted,
  entryPointRole,
  children,
}: SetupNamingContextValue & { children: ReactNode }) {
  return (
    <SetupNamingContext.Provider value={{ onWorkingDirPasted, entryPointRole }}>
      {children}
    </SetupNamingContext.Provider>
  );
}

/**
 * Returns the setup-naming context, or inert defaults when rendered outside a
 * SetupNamingProvider (e.g. Agent Settings / All Agents panels).
 */
export function useSetupNaming(): SetupNamingContextValue {
  return useContext(SetupNamingContext) ?? {};
}
