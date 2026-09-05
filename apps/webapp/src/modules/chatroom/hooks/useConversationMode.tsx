'use client';

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { useEnhancerConfig } from '../features/enhancers/hooks/useEnhancerConfig';
import { isEnhancerConfigActive } from '../features/enhancers/types/enhancer';

// ── Context ──────────────────────────────────────────────────────────────────

export interface ConversationModeContextValue {
  /** Current conversation mode selection. */
  mode: ConversationMode;
  /** Set the conversation mode. Marks the selection as user-owned. */
  setMode: (mode: ConversationMode) => void;
  /** Whether the user has explicitly cycled the mode (prevents server config from overwriting). */
  hasUserSelected: boolean;
}

const DEFAULT_MODE: ConversationMode = 'code';

const ConversationModeContext = createContext<ConversationModeContextValue>({
  mode: DEFAULT_MODE,
  setMode: () => {},
  hasUserSelected: false,
});

// ── Provider ─────────────────────────────────────────────────────────────────

interface ConversationModeProviderProps {
  chatroomId: string;
  children: React.ReactNode;
}

/**
 * Chatroom-scoped provider that seeds the conversation mode from the existing
 * enhancer config. Resets per chatroom. UI-only — no server preference.
 *
 * Seed logic:
 * - Active valid enhancer config → `code:enhanced`
 * - All other cases → `code` (historical default)
 *
 * Once the user explicitly cycles the mode, server config hydration will not
 * overwrite it.
 */
export function ConversationModeProvider({ chatroomId, children }: ConversationModeProviderProps) {
  const { config } = useEnhancerConfig(chatroomId);
  const hasUserSelectedRef = useRef(false);
  const [mode, setModeRaw] = useState<ConversationMode>(DEFAULT_MODE);

  // Track chatroom changes to reset state.
  const lastChatroomRef = useRef<string | null>(null);
  const [syncedMode, setSyncedMode] = useState<ConversationMode>(DEFAULT_MODE);

  // When chatroom changes, reset user selection and seed from config.
  if (lastChatroomRef.current !== chatroomId) {
    lastChatroomRef.current = chatroomId;
    hasUserSelectedRef.current = false;
    const initial = isEnhancerConfigActive(config) ? 'code:enhanced' : 'code';
    setSyncedMode(initial);
  }

  // Use the user-selected mode if they've cycled, otherwise the synced mode.
  const effectiveMode = hasUserSelectedRef.current ? mode : syncedMode;

  const setMode = useCallback((newMode: ConversationMode) => {
    hasUserSelectedRef.current = true;
    setModeRaw(newMode);
  }, []);

  const value = useMemo<ConversationModeContextValue>(
    () => ({
      mode: effectiveMode,
      setMode,
      hasUserSelected: hasUserSelectedRef.current,
    }),
    [effectiveMode, setMode]
  );

  return (
    <ConversationModeContext.Provider value={value}>{children}</ConversationModeContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Access the conversation mode for the current chatroom.
 * Must be used inside a `ConversationModeProvider`.
 *
 * A default context value of `code` with a no-op setter is provided so
 * isolated MessageInput tests do not need a provider.
 */
export function useConversationMode(): ConversationModeContextValue {
  return useContext(ConversationModeContext);
}
