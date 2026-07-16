'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import {
  excludeActiveSelection,
  findExactMatches,
  type TextRange,
} from '../utils/findExactMatches';

function readTextareaSelection(textarea: HTMLTextAreaElement): TextRange | null {
  const { selectionStart, selectionEnd } = textarea;
  if (selectionStart === selectionEnd) {
    return null;
  }

  return { start: selectionStart, end: selectionEnd };
}

function syncMirrorScroll(textarea: HTMLTextAreaElement, mirror: HTMLPreElement): void {
  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;
}

interface UseSelectionMatchHighlightsResult {
  mirrorRef: RefObject<HTMLPreElement | null>;
  highlightRanges: TextRange[];
  handleScroll: () => void;
  handleSelectionUpdate: () => void;
}

export function useSelectionMatchHighlights(
  content: string,
  textareaRef: RefObject<HTMLTextAreaElement | null>
): UseSelectionMatchHighlightsResult {
  const mirrorRef = useRef<HTMLPreElement>(null);
  const [activeSelection, setActiveSelection] = useState<TextRange | null>(null);

  const highlightRanges = useMemo(() => {
    if (!activeSelection) {
      return [];
    }

    const { start, end } = activeSelection;
    if (start >= end || end > content.length) {
      return [];
    }

    const needle = content.slice(start, end);
    const matches = findExactMatches(content, needle);
    return excludeActiveSelection(matches, activeSelection);
  }, [activeSelection, content]);

  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const mirror = mirrorRef.current;
    if (textarea && mirror) {
      syncMirrorScroll(textarea, mirror);
    }
  }, [textareaRef]);

  const handleSelectionUpdate = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || document.activeElement !== textarea) {
      setActiveSelection(null);
      return;
    }

    setActiveSelection(readTextareaSelection(textarea));
    syncScroll();
  }, [syncScroll, textareaRef]);

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionUpdate);
    return () => document.removeEventListener('selectionchange', handleSelectionUpdate);
  }, [handleSelectionUpdate]);

  return {
    mirrorRef,
    highlightRanges,
    handleScroll: syncScroll,
    handleSelectionUpdate,
  };
}
