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

/**
 * Quiet window before a changed server active state is applied to the view.
 * Rapid enable/disable sequences from Convex must not bounce the rendered
 * mode through intermediate values — only the final value after this long
 * of stability reconciles. Initial chatroom hydration stays immediate.
 */
export const CONVERSATION_MODE_SERVER_DEBOUNCE_MS = 2_000;

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
 * Reconciles with authoritative backend state (trailing-debounced):
 * - disabled → enabled: force `code:enhanced` (backend is authoritative)
 * - enabled → disabled: force `code` only if current mode is `code:enhanced`;
 *   otherwise preserve the user's disabled mode (chat/code)
 *
 * The debounce keeps the client mode as the rendered mode and the basis for
 * the next toggle while a server update is being watched: only a server value
 * that stays stable for CONVERSATION_MODE_SERVER_DEBOUNCE_MS reconciles.
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
  // Latest server value — lets a pending timer callback detect staleness
  // even if cleanup ordering leaves it alive.
  const latestServerActiveRef = useRef<boolean | undefined>(undefined);

  // Compute effective mode BEFORE the effect so refs stay current.
  const effectiveMode = hasUserSelectedRef.current ? mode : syncedMode;
  // Timer callbacks must read the latest client/effective mode from this ref,
  // never from the stale closure captured when the timeout was scheduled —
  // a user click during the debounce window stays the source of truth.
  const effectiveModeRef = useRef(effectiveMode);
  effectiveModeRef.current = effectiveMode;
  latestServerActiveRef.current = serverIsActive;

  // When chatroom changes, reset user selection and seed from config.
  // The reconciliation effect below re-runs on chatroomId change, so any
  // pending timeout from the previous room is cleared by its cleanup.
  if (lastChatroomRef.current !== chatroomId) {
    lastChatroomRef.current = chatroomId;
    hasUserSelectedRef.current = false;
    prevServerActiveRef.current = serverIsActive === undefined ? undefined : serverIsActive;
    latestServerActiveRef.current = serverIsActive;
    const initial = serverIsActive === true ? 'code:enhanced' : 'code';
    setSyncedMode(initial);
  }

  // Reconcile with authoritative backend state changes via a trailing debounce.
  // Initial seeding stays synchronous (handled by the chatroom-change block
  // above); only subsequent boolean transitions wait for a quiet window.
  useEffect(() => {
    if (serverIsActive === undefined) return;
    const prev = prevServerActiveRef.current;
    prevServerActiveRef.current = serverIsActive;

    // Skip on first value for this chatroom — handled by the chatroom-change
    // block above — and on same-value updates.
    if (prev === undefined || prev === serverIsActive) return;

    const timer = window.setTimeout(() => {
      // Guard against a callback that is stale despite cleanup.
      if (latestServerActiveRef.current !== serverIsActive) return;
      if (!prev && serverIsActive) {
        // disabled → enabled: backend is authoritative, force Enhanced.
        hasUserSelectedRef.current = false;
        setSyncedMode('code:enhanced');
      } else if (prev && !serverIsActive) {
        // enabled → disabled: only force Code if currently Enhanced.
        // Read via ref so a user click during the debounce window wins.
        if (effectiveModeRef.current === 'code:enhanced') {
          setSyncedMode('code');
        }
      }
    }, CONVERSATION_MODE_SERVER_DEBOUNCE_MS);

    // A new server value, chatroom change, or unmount cancels the pending
    // reconciliation. Client-mode changes do not reset the timer.
    return () => window.clearTimeout(timer);
  }, [chatroomId, serverIsActive]);

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
