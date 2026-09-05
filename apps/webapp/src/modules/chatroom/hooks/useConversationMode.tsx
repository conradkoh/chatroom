'use client';

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useEnhancerConfig } from '../features/enhancers/hooks/useEnhancerConfig';

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
 * - Active valid server config → `code:enhanced`
 * - All other cases → `code` (historical default)
 *
 * Reconciles with authoritative backend state:
 * - disabled → enabled: force `code:enhanced` (backend is authoritative)
 * - enabled → disabled: force `code` only if current mode is `code:enhanced`;
 *   otherwise preserve the user's disabled mode (chat/code)
 *
 * During an optimistic local transition (user has selected), the provider
 * defers to the toggle's success/error settlement and does not overwrite.
 */
export function ConversationModeProvider({ chatroomId, children }: ConversationModeProviderProps) {
  const { serverIsActive } = useEnhancerConfig(chatroomId);
  const hasUserSelectedRef = useRef(false);
  const [mode, setModeRaw] = useState<ConversationMode>(DEFAULT_MODE);

  // Track chatroom changes to reset state.
  const lastChatroomRef = useRef<string | null>(null);
  const [syncedMode, setSyncedMode] = useState<ConversationMode>(DEFAULT_MODE);

  // Refs for transition detection.
  const prevServerActiveRef = useRef<boolean | undefined>(undefined);

  // Compute effective mode BEFORE the effect so the effect sees the latest value.
  const effectiveMode = hasUserSelectedRef.current ? mode : syncedMode;

  // When chatroom changes, reset user selection and seed from config.
  if (lastChatroomRef.current !== chatroomId) {
    lastChatroomRef.current = chatroomId;
    hasUserSelectedRef.current = false;
    prevServerActiveRef.current = serverIsActive === undefined ? undefined : serverIsActive;
    const initial = serverIsActive === true ? 'code:enhanced' : 'code';
    setSyncedMode(initial);
  }

  // Reconcile with authoritative backend state changes via effect.
  useEffect(() => {
    if (serverIsActive === undefined) return;
    const prev = prevServerActiveRef.current;
    prevServerActiveRef.current = serverIsActive;

    // Skip on first render for this chatroom — handled by the chatroom-change block above.
    if (prev === undefined) return;

    if (!prev && serverIsActive) {
      // disabled → enabled: backend is authoritative, force Enhanced.
      hasUserSelectedRef.current = false;
      setSyncedMode('code:enhanced');
    } else if (prev && !serverIsActive) {
      // enabled → disabled: only force Code if currently Enhanced.
      // Use effectiveMode computed above (latest value, not stale closure).
      if (effectiveMode === 'code:enhanced') {
        setSyncedMode('code');
      }
    }
  }, [serverIsActive, syncedMode, effectiveMode]);

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
