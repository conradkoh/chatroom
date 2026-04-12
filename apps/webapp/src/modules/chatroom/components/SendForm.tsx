'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import React, { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import { Code2 } from 'lucide-react';

import { AttachedBacklogItemChip } from './AttachedBacklogItemChip';
import { AttachedMessageChip } from './AttachedMessageChip';
import { AttachedTaskChip } from './AttachedTaskChip';
import { ContentEditableInput, type ContentEditableInputRef } from './ContentEditableInput';
import { EditorModal } from './EditorModal';
import { FileReferenceAutocomplete } from './FileReferenceAutocomplete';
import {
  useAttachments,
  useTaskAttachments,
  useBacklogAttachments,
  useMessageAttachments,
} from '../context/AttachmentsContext';
import type { FileEntry } from './FileSelector/useFileSelector';
import { useTriggerAutocomplete } from '../hooks/useTriggerAutocomplete';
import { createFileReferenceTrigger } from '../triggers/fileReferenceTrigger';
import { generateTokenPrefix } from '@/lib/fileReference';

interface SendFormProps {
  chatroomId: string;
  onBeforeResize?: () => void;
  onAfterResize?: () => void;
  onRegisterFocus?: (focusFn: () => void) => void;
  /** Available workspace files for @ autocomplete (tagged with workspaceId) */
  files?: FileEntry[];
}

/**
 * Hook to detect if the user is on a touch device (likely mobile).
 * Uses touch capability detection rather than screen size for better accuracy.
 * Returns undefined during SSR/hydration to prevent layout flickering.
 */
function useIsTouchDevice(): boolean | undefined {
  const [mounted, setMounted] = useState(false);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    // Mark as mounted and check for touch capability.
    // Use pointer: coarse media query instead of maxTouchPoints.
    // Chrome on macOS reports maxTouchPoints > 0 for trackpads,
    // falsely detecting desktop as a touch device.
    // pointer: coarse matches actual touch screens (finger input),
    // while trackpads/mice report pointer: fine.
    setMounted(true);
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    setIsTouch(isTouchDevice);
  }, []);

  // Return undefined during SSR/hydration - component defaults to non-touch behavior
  return mounted ? isTouch : undefined;
}

// ── Draft storage helpers ──────────────────────────────────────────────────
const DRAFT_KEY_PREFIX = 'chatroom-draft:';
const MAX_DRAFTS = 10;

interface StoredDraft {
  content: string;
  updatedAt: number;
}

function parseDraft(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredDraft;
    if (parsed && typeof parsed.content === 'string') return parsed.content;
  } catch {
    // Legacy plain-string format
    return raw;
  }
  return raw;
}

function saveDraft(key: string, content: string) {
  const draft: StoredDraft = { content, updatedAt: Date.now() };
  localStorage.setItem(key, JSON.stringify(draft));
  cleanupOldDrafts(key);
}

function cleanupOldDrafts(currentKey: string) {
  const entries: { key: string; updatedAt: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(DRAFT_KEY_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    let updatedAt = 0;
    try {
      const parsed = JSON.parse(raw) as StoredDraft;
      if (parsed && typeof parsed.updatedAt === 'number') updatedAt = parsed.updatedAt;
    } catch {
      // Legacy string — treat as oldest
    }
    entries.push({ key, updatedAt });
  }
  if (entries.length <= MAX_DRAFTS) return;
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  for (const entry of entries.slice(MAX_DRAFTS)) {
    if (entry.key !== currentKey) localStorage.removeItem(entry.key);
  }
}

export const SendForm = memo(function SendForm({
  chatroomId,
  onBeforeResize: _onBeforeResize,
  onAfterResize: _onAfterResize,
  onRegisterFocus,
  files = [],
}: SendFormProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<ContentEditableInputRef>(null);
  const formContainerRef = useRef<HTMLDivElement>(null);
  const isTouchDevice = useIsTouchDevice();

  const [editorOpen, setEditorOpen] = useState(false);

  // Generate a stable prefix per component instance (regenerated on mount/chatroom switch)
  const [tokenPrefix] = useState(() => generateTokenPrefix());

  // ── Trigger autocomplete (replaces hardcoded @ detection) ─────────────────
  const fileRefTrigger = useMemo(() => createFileReferenceTrigger(files, tokenPrefix), [files, tokenPrefix]);
  const triggers = useMemo(() => [fileRefTrigger], [fileRefTrigger]);

  const getCaretPosition = useCallback(() => {
    const caretPos = inputRef.current?.getCaretPixelPosition() ?? null;
    if (!caretPos) return null;

    // The caret position is relative to the contenteditable element, but the
    // dropdown is absolutely positioned within formContainerRef. Adjust left
    // by the horizontal offset between the two containers so the dropdown
    // aligns with the trigger character, not shifted by ~2 chars.
    const inputEl = inputRef.current?.getElement();
    const formEl = formContainerRef.current;
    if (inputEl && formEl) {
      const inputRect = inputEl.getBoundingClientRect();
      const formRect = formEl.getBoundingClientRect();
      return {
        ...caretPos,
        left: caretPos.left + (inputRect.left - formRect.left),
      };
    }

    return caretPos;
  }, []);

  const autocomplete = useTriggerAutocomplete<FileEntry>(triggers, { getCaretPosition });

  // Register focus callback for external callers
  useEffect(() => {
    onRegisterFocus?.(() => {
      inputRef.current?.focus();
    });
  }, [onRegisterFocus]);

  // ── Draft persistence ─────────────────────────────────────────────────────
  const draftKey = `chatroom-draft:${chatroomId}`;

  // Restore draft on mount (once per chatroomId) and auto-focus the input
  useEffect(() => {
    const saved = parseDraft(localStorage.getItem(draftKey));
    if (saved) setMessage(saved);
    // Auto-focus when switching chatrooms (non-touch devices only)
    if (!isTouchDevice) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatroomId]);

  // Debounced save: write 500ms after the last keystroke, clear when empty
  useEffect(() => {
    const timer = setTimeout(() => {
      if (message) {
        saveDraft(draftKey, message);
      } else {
        localStorage.removeItem(draftKey);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [message, draftKey]);

  // Attachments context
  const { remove, clearAll } = useAttachments();
  const attachedTasks = useTaskAttachments();
  const attachedBacklogItems = useBacklogAttachments();
  const attachedMessages = useMessageAttachments();

  const sendMessage = useSessionMutation(api.messages.send);

  // Shared send logic used by both inline submit and editor modal
  const doSend = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return;
      setSending(true);
      try {
        await sendMessage({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          senderRole: 'user',
          content: text.trim(),
          type: 'message',
          ...(attachedTasks.length > 0 && {
            attachedTaskIds: attachedTasks.map((task) => task.id),
          }),
          ...(attachedBacklogItems.length > 0 && {
            attachedBacklogItemIds: attachedBacklogItems.map((item) => item.id),
          }),
          ...(attachedMessages.length > 0 && {
            attachedMessageIds: attachedMessages.map((msg) => msg.id),
          }),
        });
        setMessage('');
        localStorage.removeItem(draftKey);
        if (
          attachedTasks.length > 0 ||
          attachedBacklogItems.length > 0 ||
          attachedMessages.length > 0
        ) {
          clearAll();
        }
        setTimeout(() => inputRef.current?.focus(), 0);
      } catch (error) {
        console.error('Failed to send message:', error);
      } finally {
        setSending(false);
      }
    },
    [
      sending,
      sendMessage,
      chatroomId,
      attachedTasks,
      attachedBacklogItems,
      attachedMessages,
      clearAll,
      draftKey,
    ]
  );

  const handleSubmit = useCallback(async () => {
    await doSend(message);
  }, [doSend, message]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Let the trigger autocomplete hook handle navigation keys first
      if (autocomplete.state.visible) {
        // Arrow keys, Escape are handled by the hook
        if (autocomplete.handleKeyDown(e.nativeEvent)) return;

        // Enter/Tab: select the current result
        if (
          (e.key === 'Enter' || e.key === 'Tab') &&
          autocomplete.state.results.length > 0 &&
          autocomplete.state.selectedIndex < autocomplete.state.results.length
        ) {
          e.preventDefault();
          const selectedItem = autocomplete.state.results[autocomplete.state.selectedIndex]!;
          const { newText, newCursorPos } = autocomplete.handleSelect(selectedItem, message);
          setMessage(newText);
          setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.setCursorOffset(newCursorPos);
          }, 0);
          return;
        }
      }

      // On touch devices (mobile), Enter creates a newline
      // Submission only happens via the Send button
      if (isTouchDevice) {
        // Allow default behavior (newline) on Enter
        return;
      }

      // Normal mode: Enter without Shift sends the message
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      // Shift+Enter allows newline (default behavior)
    },
    [handleSubmit, isTouchDevice, autocomplete, message]
  );

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      handleSubmit();
    },
    [handleSubmit]
  );

  const handleContentChange = useCallback(
    (newValue: string) => {
      setMessage(newValue);

      // Get cursor position from the contenteditable
      const cursorPos = inputRef.current?.getCursorOffset() ?? newValue.length;

      // Delegate trigger detection to the autocomplete hook
      autocomplete.handleInputChange(newValue, cursorPos);
    },
    [autocomplete]
  );

  // ── Autocomplete file select callback ───────────────────────────────────────
  const handleFileSelect = useCallback(
    (filePath: string) => {
      // Find the file entry from results that matches this path
      const fileEntry = autocomplete.state.results.find((f) => f.path === filePath);
      if (!fileEntry) return;

      const { newText, newCursorPos } = autocomplete.handleSelect(fileEntry, message);
      setMessage(newText);

      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.setCursorOffset(newCursorPos);
      }, 0);
    },
    [autocomplete, message]
  );

  // ── Editor modal callbacks ────────────────────────────────────────────────────
  const handleEditorClose = useCallback((editedText: string) => {
    setMessage(editedText);
    setEditorOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleEditorSend = useCallback(
    async (text: string) => {
      setMessage(text);
      setEditorOpen(false);
      await doSend(text);
    },
    [doSend]
  );

  return (
    <div ref={formContainerRef} className="relative bg-chatroom-bg-surface backdrop-blur-xl">
      {/* @ file reference autocomplete dropdown */}
      <FileReferenceAutocomplete
        results={autocomplete.state.results}
        selectedIndex={autocomplete.state.selectedIndex}
        position={autocomplete.state.position}
        onSelect={handleFileSelect}
        onHoverItem={autocomplete.setSelectedIndex}
        visible={autocomplete.state.visible}
      />

      {/* Attached Tasks Row */}
      {(attachedTasks.length > 0 ||
        attachedBacklogItems.length > 0 ||
        attachedMessages.length > 0) && (
        <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
          {attachedTasks.map((task) => (
            <AttachedTaskChip
              key={task.id}
              taskId={task.id}
              content={task.content}
              onRemove={() => remove('task', task.id)}
            />
          ))}
          {attachedBacklogItems.map((item) => (
            <AttachedBacklogItemChip
              key={item.id}
              itemId={item.id}
              content={item.content}
              onRemove={() => remove('backlog', item.id)}
            />
          ))}
          {attachedMessages.map((msg) => (
            <AttachedMessageChip
              key={msg.id}
              messageId={msg.id}
              content={msg.content}
              senderRole={msg.senderRole}
              onRemove={() => remove('message', msg.id)}
            />
          ))}
        </div>
      )}
      {/* Input Form */}
      <form className="flex items-end gap-3 p-4" onSubmit={handleFormSubmit}>
        <ContentEditableInput
          ref={inputRef}
          value={message}
          onChange={handleContentChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={sending}
        />

        <div className="flex items-center gap-2 flex-shrink-0">
          {!isTouchDevice && (
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              title="Open editor"
              className="p-2.5 border-2 transition-all duration-100 bg-chatroom-bg-primary text-chatroom-text-muted border-chatroom-border hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
            >
              <Code2 size={14} />
            </button>
          )}
          <button
            type="submit"
            disabled={!message.trim() || sending}
            onPointerDown={(e) => {
              e.preventDefault();
            }}
            className="bg-chatroom-accent text-chatroom-bg-primary border-2 border-chatroom-accent px-5 py-2.5 font-bold text-xs uppercase tracking-wider cursor-pointer transition-all duration-100 hover:bg-chatroom-text-secondary hover:border-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </form>

      {/* Editor Modal */}
      <EditorModal
        isOpen={editorOpen}
        initialValue={message}
        onClose={handleEditorClose}
        onSend={handleEditorSend}
      />
    </div>
  );
});
