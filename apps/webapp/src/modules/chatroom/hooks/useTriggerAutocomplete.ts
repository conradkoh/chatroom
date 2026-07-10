'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

/** A trigger definition that can be registered with the autocomplete system. */
export interface TriggerDefinition<T = unknown> {
  /** The character that activates this trigger (e.g., '@', '/', '#') */
  triggerChar: string;

  /**
   * Check if the trigger character at this position is valid.
   * E.g., '@' is valid only at start or after whitespace.
   */
  isValidPosition: (textBeforeCursor: string, triggerIndex: number) => boolean;

  /**
   * Check if the trigger system is available/enabled.
   * E.g., file references need files + workspaceName to be present.
   */
  isEnabled: () => boolean;

  /**
   * Get filtered/scored results for the current query.
   * Should return items sorted by relevance.
   */
  getResults: (query: string) => T[];

  /**
   * Serialize a selected item into text to insert into the message.
   * E.g., for files: return the file path
   */
  serialize: (item: T) => string;

  /**
   * Serialize a selected item when drill-down should continue (e.g. directory navigation).
   * Inserted after the trigger character while keeping autocomplete open.
   */
  serializeDrillDown?: (item: T) => string;

  /**
   * Extract the active query from text before the cursor.
   * Return null to dismiss autocomplete for this trigger.
   */
  extractQuery?: (textBeforeCursor: string, triggerIndex: number) => string | null;

  /** Whether selecting this item should keep autocomplete open for continued navigation. */
  shouldKeepOpen?: (item: T) => boolean;

  /** Called once when this trigger starts a new visible autocomplete activation. */
  onActivate?: () => void;

  /** Max items to display in the dropdown */
  maxDisplayItems?: number;
}

export interface TriggerAutocompleteState<T = unknown> {
  visible: boolean;
  query: string;
  position: { top: number; left: number } | null;
  selectedIndex: number;
  results: T[];
  activeTrigger: TriggerDefinition<T> | null;
}

export interface UseTriggerAutocompleteReturn<T = unknown> {
  state: TriggerAutocompleteState<T>;
  /** Call this from the textarea's onChange handler */
  handleInputChange: (text: string, cursorPos: number) => void;
  /** Call when a result is selected. Returns new text and cursor position for the caller to apply. */
  handleSelect: (
    item: T,
    currentMessage: string
  ) => { newText: string; newCursorPos: number; keepOpen?: boolean };
  /** Dismiss the autocomplete */
  handleDismiss: () => void;
  /** Returns true if the key was handled by autocomplete (so SendForm can skip it) */
  handleKeyDown: (e: KeyboardEvent) => boolean;
  /** Update selectedIndex (e.g., on mouse hover) */
  setSelectedIndex: (index: number) => void;
}

// ── Options ──────────────────────────────────────────────────────────────────

export interface UseTriggerAutocompleteOptions {
  /** Calculate caret pixel coordinates for positioning the dropdown */
  getCaretPosition?: () => { top: number; left: number; height: number } | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

function clampSelectedIndex(index: number, resultCount: number): number {
  if (resultCount <= 0) return 0;
  return Math.min(Math.max(index, 0), resultCount - 1);
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Generic autocomplete hook that manages trigger detection, query extraction,
 * debounced query updates, and keyboard navigation for an array of trigger
 * definitions. The first enabled trigger whose character matches wins.
 */
export function useTriggerAutocomplete<T = unknown>(
  triggers: TriggerDefinition<T>[],
  options?: UseTriggerAutocompleteOptions
): UseTriggerAutocompleteReturn<T> {
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [results, setResults] = useState<T[]>([]);
  const [activeTrigger, setActiveTrigger] = useState<TriggerDefinition<T> | null>(null);

  /** Cursor index where the trigger character was typed */
  const triggerIndexRef = useRef<number | null>(null);
  /** Ref for results to avoid stale closures in handleKeyDown */
  const resultsRef = useRef<T[]>(results);
  /** Ref for activeTrigger to avoid stale closure */
  const activeTriggerRef = useRef<TriggerDefinition<T> | null>(activeTrigger);
  activeTriggerRef.current = activeTrigger;
  /** Tracks the current trigger activation so onActivate fires once per show cycle. */
  const activationKeyRef = useRef<string | null>(null);
  /** Index of the active trigger in the triggers array (for refreshing results). */
  const activeTriggerOrderRef = useRef<number | null>(null);

  resultsRef.current = results;

  // Refresh results when trigger definitions change while autocomplete is open
  // (e.g. workspace files finish loading after the user typed @).
  useEffect(() => {
    if (!visible || activeTriggerOrderRef.current === null) return;

    const trigger = triggers[activeTriggerOrderRef.current];
    if (!trigger?.isEnabled()) return;

    const newResults = trigger.getResults(query);
    const prev = resultsRef.current;
    if (
      prev.length === newResults.length &&
      prev.every((item, index) => item === newResults[index])
    ) {
      return;
    }

    setResults(newResults);
    setSelectedIndex((prev) => clampSelectedIndex(prev, newResults.length));
  }, [triggers, visible, query]);

  // ── Input change: detect triggers ──────────────────────────────────────────

  // fallow-ignore-next-line complexity
  const handleInputChange = useCallback(
    (text: string, cursorPos: number) => {
      const textBeforeCursor = text.slice(0, cursorPos);

      // Check triggers in priority order — first enabled match wins
      for (const [triggerOrder, trigger] of triggers.entries()) {
        if (!trigger.isEnabled()) continue;

        const lastTriggerIndex = textBeforeCursor.lastIndexOf(trigger.triggerChar);
        if (lastTriggerIndex === -1) continue;

        if (!trigger.isValidPosition(textBeforeCursor, lastTriggerIndex)) continue;

        const q =
          trigger.extractQuery?.(textBeforeCursor, lastTriggerIndex) ??
          (() => {
            const raw = textBeforeCursor.slice(lastTriggerIndex + trigger.triggerChar.length);
            return /\s/.test(raw) ? null : raw;
          })();
        if (q === null) continue;

        // Found a valid trigger — show dropdown immediately, debounce query
        triggerIndexRef.current = lastTriggerIndex;
        activeTriggerOrderRef.current = triggerOrder;
        const activationKey = `${triggerOrder}:${trigger.triggerChar}:${lastTriggerIndex}`;
        if (activationKeyRef.current !== activationKey) {
          activationKeyRef.current = activationKey;
          trigger.onActivate?.();
        }
        setVisible(true);

        // Calculate position from caret if available, otherwise use default
        const caretPos = options?.getCaretPosition?.();
        if (caretPos) {
          setPosition({ top: caretPos.height + 4, left: caretPos.left });
        } else {
          setPosition({ top: 4, left: 0 });
        }

        setActiveTrigger(trigger);

        const newResults = trigger.getResults(q);
        setQuery(q);
        setResults(newResults);
        setSelectedIndex(0);

        return;
      }

      // No valid trigger found — dismiss
      setVisible(false);
      setActiveTrigger(null);
      activationKeyRef.current = null;
      triggerIndexRef.current = null;
      activeTriggerOrderRef.current = null;
    },
    [triggers, options]
  );

  // ── Selection ──────────────────────────────────────────────────────────────

  const handleSelect = useCallback(
    (
      item: T,
      currentMessage: string
    ): { newText: string; newCursorPos: number; keepOpen?: boolean } => {
      const trigger = activeTriggerRef.current;
      if (!trigger || triggerIndexRef.current === null) {
        return { newText: currentMessage, newCursorPos: currentMessage.length };
      }

      const keepOpen = trigger.shouldKeepOpen?.(item) ?? false;
      const serialized = keepOpen
        ? (trigger.serializeDrillDown ?? trigger.serialize)(item)
        : trigger.serialize(item);
      const triggerStart = triggerIndexRef.current;
      const queryEndPos = triggerStart + trigger.triggerChar.length + query.length;

      const before = currentMessage.slice(0, triggerStart);
      const after = currentMessage.slice(queryEndPos);

      if (keepOpen) {
        const newText = `${before}${trigger.triggerChar}${serialized}${after}`;
        const newCursorPos = before.length + trigger.triggerChar.length + serialized.length;

        setQuery(serialized);
        setResults(trigger.getResults(serialized));
        setSelectedIndex(0);
        setVisible(true);
        setActiveTrigger(trigger);

        return { newText, newCursorPos, keepOpen: true };
      }

      const newText = `${before}${serialized} ${after}`;
      const newCursorPos = before.length + serialized.length + 1;

      setVisible(false);
      setActiveTrigger(null);
      activationKeyRef.current = null;
      triggerIndexRef.current = null;
      activeTriggerOrderRef.current = null;

      return { newText, newCursorPos, keepOpen: false };
    },
    [query]
  );

  // ── Dismiss ────────────────────────────────────────────────────────────────

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setActiveTrigger(null);
    activationKeyRef.current = null;
    triggerIndexRef.current = null;
    activeTriggerOrderRef.current = null;
  }, []);

  // ── Keyboard navigation ────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent): boolean => {
      if (!visible) return false;

      const currentResults = resultsRef.current;
      if (currentResults.length === 0) return false;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((prev) => clampSelectedIndex(prev + 1, currentResults.length));
          return true;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((prev) => clampSelectedIndex(prev - 1, currentResults.length));
          return true;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          handleDismiss();
          return true;
        // Enter and Tab are NOT handled here — they need message text context,
        // so they're handled in the caller (SendForm) via handleSelect
        default:
          return false;
      }
    },
    [visible, handleDismiss]
  );

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    state: {
      visible,
      query,
      position,
      selectedIndex,
      results,
      activeTrigger,
    },
    handleInputChange,
    handleSelect,
    handleDismiss,
    handleKeyDown,
    setSelectedIndex,
  };
}
