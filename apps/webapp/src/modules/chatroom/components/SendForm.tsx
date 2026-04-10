'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import { Code2 } from 'lucide-react';

import { AttachedBacklogItemChip } from './AttachedBacklogItemChip';
import { AttachedMessageChip } from './AttachedMessageChip';
import { AttachedTaskChip } from './AttachedTaskChip';
import { EditorModal } from './EditorModal';
import { FileReferenceAutocomplete } from './FileReferenceAutocomplete';
import {
  useAttachments,
  useTaskAttachments,
  useBacklogAttachments,
  useMessageAttachments,
} from '../context/AttachmentsContext';
import type { FileEntry } from './FileSelector/useFileSelector';
import { encodeFileReference } from '@/lib/fileReference';

interface SendFormProps {
  chatroomId: string;
  onBeforeResize?: () => void;
  onAfterResize?: () => void;
  onRegisterFocus?: (focusFn: () => void) => void;
  /** Available workspace files for @ autocomplete */
  files?: FileEntry[];
  /** Workspace name used for file reference encoding */
  workspaceName?: string;
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
  onBeforeResize,
  onAfterResize,
  onRegisterFocus,
  files = [],
  workspaceName,
}: SendFormProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formContainerRef = useRef<HTMLDivElement>(null);
  const isTouchDevice = useIsTouchDevice();

  const [editorOpen, setEditorOpen] = useState(false);

  // ── @ autocomplete state ──────────────────────────────────────────────────
  const [autocompleteVisible, setAutocompleteVisible] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const [autocompletePosition, setAutocompletePosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  /** Cursor index where the `@` trigger was typed */
  const atTriggerIndexRef = useRef<number | null>(null);

  // Register focus callback for external callers
  useEffect(() => {
    onRegisterFocus?.(() => {
      textareaRef.current?.focus();
    });
  }, [onRegisterFocus]);

  // ── Draft persistence ─────────────────────────────────────────────────────
  const draftKey = `chatroom-draft:${chatroomId}`;

  // Restore draft on mount (once per chatroomId) and auto-focus the textarea
  useEffect(() => {
    const saved = parseDraft(localStorage.getItem(draftKey));
    if (saved) setMessage(saved);
    // Auto-focus when switching chatrooms (non-touch devices only)
    if (!isTouchDevice) {
      setTimeout(() => textareaRef.current?.focus(), 0);
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

  // Auto-resize textarea based on content
  // Uses useLayoutEffect for synchronous DOM measurement before paint
  // Uses height:0 technique for accurate scrollHeight in Safari
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    onBeforeResize?.();

    // Set height to 0 to get accurate scrollHeight (Safari workaround)
    textarea.style.height = '0px';
    const scrollHeight = textarea.scrollHeight;
    // Set to content height, capped at max with min of 40px (matches button height)
    const newHeight = Math.max(40, Math.min(scrollHeight, 200));
    textarea.style.height = `${newHeight}px`;
    // Only show overflow when content exceeds max height
    textarea.style.overflowY = scrollHeight > 200 ? 'auto' : 'hidden';

    onAfterResize?.();
  }, [message, onBeforeResize, onAfterResize]);

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
        setTimeout(() => textareaRef.current?.focus(), 0);
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
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // When autocomplete is visible, let it handle navigation keys
      // The autocomplete component captures keydown events in capture phase
      if (
        autocompleteVisible &&
        (e.key === 'Enter' ||
          e.key === 'Tab' ||
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'Escape')
      ) {
        return;
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
    [handleSubmit, isTouchDevice, autocompleteVisible]
  );

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      handleSubmit();
    },
    [handleSubmit]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;
      setMessage(newValue);

      // ── @ trigger detection ──────────────────────────────────────────────
      if (files.length > 0 && workspaceName) {
        // Look backwards from cursor for an unmatched @ trigger
        const textBeforeCursor = newValue.slice(0, cursorPos);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');

        if (lastAtIndex !== -1) {
          // @ must be at start of input or preceded by whitespace
          const charBefore = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
          const isValidTrigger =
            charBefore === ' ' || charBefore === '\n' || charBefore === '\t' || lastAtIndex === 0;

          if (isValidTrigger) {
            const query = textBeforeCursor.slice(lastAtIndex + 1);
            // Don't show autocomplete if query contains whitespace (user moved on)
            if (!/\s/.test(query)) {
              atTriggerIndexRef.current = lastAtIndex;
              setAutocompleteQuery(query);
              setAutocompleteVisible(true);

              // Position the dropdown above the textarea
              // We use a simple fixed position: above the form container
              setAutocompletePosition({ top: 4, left: 0 });
              return;
            }
          }
        }

        // No valid trigger found — dismiss
        setAutocompleteVisible(false);
        atTriggerIndexRef.current = null;
      }
    },
    [files.length, workspaceName]
  );

  // ── @ autocomplete callbacks ───────────────────────────────────────────────
  const handleFileSelect = useCallback(
    (filePath: string) => {
      if (!workspaceName || atTriggerIndexRef.current === null) return;

      const triggerStart = atTriggerIndexRef.current;
      const textarea = textareaRef.current;
      const cursorPos = textarea?.selectionStart ?? message.length;

      // Replace @query with the encoded file reference
      const encoded = encodeFileReference(workspaceName, filePath);
      const before = message.slice(0, triggerStart);
      const after = message.slice(cursorPos);
      const newMessage = before + encoded + ' ' + after;

      setMessage(newMessage);
      setAutocompleteVisible(false);
      atTriggerIndexRef.current = null;

      // Restore focus and cursor position after the inserted reference
      const newCursorPos = before.length + encoded.length + 1;
      setTimeout(() => {
        if (textarea) {
          textarea.focus();
          textarea.selectionStart = newCursorPos;
          textarea.selectionEnd = newCursorPos;
        }
      }, 0);
    },
    [message, workspaceName]
  );

  const handleAutocompleteDismiss = useCallback(() => {
    setAutocompleteVisible(false);
    atTriggerIndexRef.current = null;
  }, []);

  // ── Editor modal callbacks ────────────────────────────────────────────────────
  const handleEditorClose = useCallback((editedText: string) => {
    setMessage(editedText);
    setEditorOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
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
        files={files}
        query={autocompleteQuery}
        position={autocompletePosition}
        onSelect={handleFileSelect}
        onDismiss={handleAutocompleteDismiss}
        visible={autocompleteVisible}
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
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={sending}
          rows={1}
          className="flex-1 min-h-[40px] bg-chatroom-bg-primary border-2 border-chatroom-border text-chatroom-text-primary text-sm px-3 py-2 resize-none max-h-[200px] overflow-hidden leading-6 placeholder:text-chatroom-text-muted placeholder:leading-6 focus:outline-none focus:border-chatroom-border-strong disabled:opacity-50 disabled:cursor-not-allowed align-middle"
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
