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
   * E.g., for files: encodeFileReference(workspace, filePath)
   */
  serialize: (item: T) => string;

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
  handleSelect: (item: T, currentMessage: string) => { newText: string; newCursorPos: number };
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

const DEBOUNCE_MS = 80;

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
  /** Debounce timer for query updates */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Ref for results to avoid stale closures in handleKeyDown */
  const resultsRef = useRef<T[]>(results);
  resultsRef.current = results;
  /** Ref for activeTrigger to avoid stale closure */
  const activeTriggerRef = useRef<TriggerDefinition<T> | null>(activeTrigger);
  activeTriggerRef.current = activeTrigger;

  // Clean up the debounce timer on unmount so we don't fire a setState on
  // an unmounted component (or keep a stale timeout running).
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Input change: detect triggers ──────────────────────────────────────────

  const handleInputChange = useCallback(
    (text: string, cursorPos: number) => {
      const textBeforeCursor = text.slice(0, cursorPos);

      // Check triggers in priority order — first enabled match wins
      for (const trigger of triggers) {
        if (!trigger.isEnabled()) continue;

        const lastTriggerIndex = textBeforeCursor.lastIndexOf(trigger.triggerChar);
        if (lastTriggerIndex === -1) continue;

        if (!trigger.isValidPosition(textBeforeCursor, lastTriggerIndex)) continue;

        const q = textBeforeCursor.slice(lastTriggerIndex + trigger.triggerChar.length);
        // Don't show autocomplete if query contains whitespace (user moved on)
        if (/\s/.test(q)) continue;

        // Found a valid trigger — show dropdown immediately, debounce query
        triggerIndexRef.current = lastTriggerIndex;
        setVisible(true);

        // Calculate position from caret if available, otherwise use default
        const caretPos = options?.getCaretPosition?.();
        if (caretPos) {
          setPosition({ top: caretPos.height + 4, left: caretPos.left });
        } else {
          setPosition({ top: 4, left: 0 });
        }

        setActiveTrigger(trigger);

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          const newResults = trigger.getResults(q);
          setQuery(q);
          setResults(newResults);
          // Reset selection on new results unless query stayed the same
          setSelectedIndex(0);
        }, DEBOUNCE_MS);

        return;
      }

      // No valid trigger found — dismiss
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setVisible(false);
      setActiveTrigger(null);
      triggerIndexRef.current = null;
    },
    [triggers, options]
  );

  // ── Selection ──────────────────────────────────────────────────────────────

  const handleSelect = useCallback(
    (item: T, currentMessage: string): { newText: string; newCursorPos: number } => {
      const trigger = activeTriggerRef.current;
      if (!trigger || triggerIndexRef.current === null) {
        return { newText: currentMessage, newCursorPos: currentMessage.length };
      }

      const serialized = trigger.serialize(item);
      const triggerStart = triggerIndexRef.current;
      // Find current cursor position: text from trigger start + trigger char + query
      // We need to find where the query ends. Since we stored triggerIndex,
      // the text to replace is from triggerIndex to current cursor.
      // But we don't have the cursor here — we use the query length as a proxy.
      const queryEndPos = triggerStart + trigger.triggerChar.length + query.length;

      const before = currentMessage.slice(0, triggerStart);
      const after = currentMessage.slice(queryEndPos);
      const newText = before + serialized + ' ' + after;
      const newCursorPos = before.length + serialized.length + 1;

      // Dismiss
      setVisible(false);
      setActiveTrigger(null);
      triggerIndexRef.current = null;

      return { newText, newCursorPos };
    },
    [query]
  );

  // ── Dismiss ────────────────────────────────────────────────────────────────

  const handleDismiss = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setVisible(false);
    setActiveTrigger(null);
    triggerIndexRef.current = null;
  }, []);

  // ── Keyboard navigation ────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent): boolean => {
      if (!visible) return false;

      const currentResults = resultsRef.current;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((prev) => Math.min(prev + 1, currentResults.length - 1));
          return true;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
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
