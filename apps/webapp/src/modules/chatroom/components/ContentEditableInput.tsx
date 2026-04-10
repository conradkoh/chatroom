'use client';

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';

import {
  rawTextToHtml,
  htmlToRawText,
  domOffsetToRawOffset,
  setCursorToRawOffset,
} from '@/lib/fileReferenceSerializer';

// ── Public types ─────────────────────────────────────────────────────────────

export interface ContentEditableInputRef {
  /** Focus the input */
  focus: () => void;
  /** Get the cursor position as a character offset in the raw text */
  getCursorOffset: () => number;
  /** Get pixel coordinates of the cursor for positioning dropdowns */
  getCaretPixelPosition: () => { top: number; left: number; height: number } | null;
  /** Set cursor position to a character offset in the raw text */
  setCursorOffset: (offset: number) => void;
}

interface ContentEditableInputProps {
  /** Raw text value (with {file://...} tokens) */
  value: string;
  /** Called with the new raw text value */
  onChange: (value: string) => void;
  /** Forwarded keydown handler */
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** CSS class name */
  className?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export const ContentEditableInput = forwardRef<ContentEditableInputRef, ContentEditableInputProps>(
  function ContentEditableInput(
    { value, onChange, onKeyDown, placeholder, disabled = false, className },
    ref
  ) {
    const divRef = useRef<HTMLDivElement>(null);
    /** Track the last HTML we set to avoid unnecessary re-renders */
    const lastHtmlRef = useRef<string>('');
    /**
     * Flag: when true, skip the next useLayoutEffect that syncs HTML from value.
     *
     * Flow: handleInput() sets suppressSync=true right before calling onChange(raw).
     * That onChange triggers a value prop update, which fires the useLayoutEffect.
     * If we let the effect re-render HTML into the contenteditable, it would reset
     * the browser caret position — breaking mid-typing. So suppressSync skips that
     * one cycle, and the effect resets the flag to false immediately, so that
     * *external* value changes (autocomplete insertion, draft restore, send-clear)
     * DO get synced into the DOM normally.
     */
    const suppressSyncRef = useRef(false);

    // ── Imperative handle ──────────────────────────────────────────────────

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          divRef.current?.focus();
        },

        getCursorOffset(): number {
          const el = divRef.current;
          if (!el) return 0;
          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0) return 0;
          return domOffsetToRawOffset(el, selection.anchorNode!, selection.anchorOffset);
        },

        getCaretPixelPosition(): { top: number; left: number; height: number } | null {
          const el = divRef.current;
          if (!el) return null;
          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0) return null;

          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const containerRect = el.getBoundingClientRect();

          // Return coordinates relative to the contenteditable element
          return {
            top: rect.top - containerRect.top,
            left: rect.left - containerRect.left,
            height: rect.height || parseInt(getComputedStyle(el).lineHeight) || 24,
          };
        },

        setCursorOffset(offset: number) {
          const el = divRef.current;
          if (!el) return;
          setCursorToRawOffset(el, offset);
        },
      }),
      []
    );

    // ── Sync value → HTML ──────────────────────────────────────────────────
    // Only re-render HTML when the value changes from an external source
    // (e.g., autocomplete selection, draft restore, message send clearing).
    // When the user is typing, suppressSyncRef prevents cursor-jumping re-renders.

    useLayoutEffect(() => {
      if (suppressSyncRef.current) {
        suppressSyncRef.current = false;
        return;
      }

      const el = divRef.current;
      if (!el) return;

      const html = rawTextToHtml(value);
      if (html !== lastHtmlRef.current) {
        lastHtmlRef.current = html;
        el.innerHTML = html;
      }
    }, [value]);

    // ── Input handler ──────────────────────────────────────────────────────

    const handleInput = useCallback(() => {
      const el = divRef.current;
      if (!el) return;

      // Read raw text from DOM
      const raw = htmlToRawText(el);

      // Track the current HTML so we don't re-render it back
      lastHtmlRef.current = el.innerHTML;
      // Suppress the next sync from the value prop change
      suppressSyncRef.current = true;

      onChange(raw);
    }, [onChange]);

    // ── Paste handler ──────────────────────────────────────────────────────
    // Intercept paste to insert only plain text, preventing rich HTML from
    // being pasted into the contenteditable.

    const handlePaste = useCallback(
      (e: React.ClipboardEvent<HTMLDivElement>) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        if (!text) return;

        // Insert plain text at cursor position
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);

        // Move cursor to end of inserted text
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);

        // Trigger input handling
        handleInput();
      },
      [handleInput]
    );

    // ── Keydown handler ────────────────────────────────────────────────────

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        // Forward to parent handler
        onKeyDown?.(e);
      },
      [onKeyDown]
    );

    // ── Focus management ───────────────────────────────────────────────────

    // Set initial content on mount
    useEffect(() => {
      const el = divRef.current;
      if (!el) return;
      const html = rawTextToHtml(value);
      lastHtmlRef.current = html;
      el.innerHTML = html;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Render ─────────────────────────────────────────────────────────────

    return (
      <div className="relative flex-1">
        <div
          ref={divRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          aria-placeholder={placeholder}
          data-placeholder={placeholder}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className={
            className ??
            [
              'min-h-[40px] max-h-[200px] overflow-y-auto',
              'bg-chatroom-bg-primary border-2 border-chatroom-border',
              'text-chatroom-text-primary text-sm px-3 py-2 leading-6',
              'focus:outline-none focus:border-chatroom-border-strong',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'whitespace-pre-wrap break-words',
              // Placeholder via CSS — shown when contenteditable is empty
              'empty:before:content-[attr(data-placeholder)]',
              'empty:before:text-chatroom-text-muted empty:before:pointer-events-none',
            ].join(' ')
          }
        />
      </div>
    );
  }
);
