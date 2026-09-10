'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// ── Context ──────────────────────────────────────────────────────────────────

export interface ConversationModeContextValue {
  /** Current conversation mode selection. */
  mode: ConversationMode;
  /** Set the conversation mode. Marks the selection as user-owned. */
  setMode: (mode: ConversationMode) => void;
  /** Whether the user has explicitly cycled the mode (prevents server config from overwriting). */
  hasUserSelected: boolean;
}

const DEFAULT_CONVERSATION_MODE: ConversationMode = 'chat';

const ConversationModeContext = createContext<ConversationModeContextValue>({
  mode: DEFAULT_CONVERSATION_MODE,
  setMode: () => {},
  hasUserSelected: false,
});

// ── Provider ─────────────────────────────────────────────────────────────────

interface ConversationModeProviderProps {
  chatroomId: string;
  children: React.ReactNode;
}

/**
 * Chatroom-scoped provider for the user's persisted conversation-mode choice.
 * A missing backend preference intentionally resolves to Chat.
 */
export function ConversationModeProvider({ chatroomId, children }: ConversationModeProviderProps) {
  const persistedMode = useSessionQuery(api.web.conversationModePreferences.get, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });
  const setPersistedMode = useSessionMutation(api.web.conversationModePreferences.set);
  const hasUserSelectedRef = useRef(false);
  const [mode, setModeRaw] = useState<ConversationMode>(DEFAULT_CONVERSATION_MODE);

  // Track chatroom changes to reset state.
  const lastChatroomRef = useRef<string | null>(null);
  const [syncedMode, setSyncedMode] = useState<ConversationMode>(DEFAULT_CONVERSATION_MODE);

  // Compute effective mode BEFORE the effect so refs stay current.
  const effectiveMode = hasUserSelectedRef.current ? mode : syncedMode;
  // When chatroom changes, reset user selection and show the product default
  // until the persisted preference query hydrates.
  if (lastChatroomRef.current !== chatroomId) {
    lastChatroomRef.current = chatroomId;
    hasUserSelectedRef.current = false;
    setSyncedMode(DEFAULT_CONVERSATION_MODE);
  }

  // Hydrate the authoritative persisted preference. `undefined` means loading;
  // null means no preference exists and keeps Chat.
  useEffect(() => {
    if (persistedMode === undefined || hasUserSelectedRef.current) return;
    setSyncedMode(persistedMode ?? DEFAULT_CONVERSATION_MODE);
  }, [chatroomId, persistedMode]);

  const setMode = useCallback(
    (newMode: ConversationMode) => {
      hasUserSelectedRef.current = true;
      setModeRaw(newMode);
      // Also update the hydrated value so selecting the current optimistic
      // value still causes a render when the provider just loaded a backend
      // preference.
      setSyncedMode(newMode);
      void setPersistedMode({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        mode: newMode,
      }).catch((error: unknown) => {
        console.error('[ConversationMode] failed to persist mode:', error);
      });
    },
    [chatroomId, setPersistedMode]
  );

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
 * A default context value of `chat` with a no-op setter is provided so
 * isolated MessageInput tests do not need a provider.
 */
export function useConversationMode(): ConversationModeContextValue {
  return useContext(ConversationModeContext);
}
