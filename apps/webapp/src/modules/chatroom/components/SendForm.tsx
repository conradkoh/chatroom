'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import React, { useState, useRef, useEffect, useCallback, memo } from 'react';

import { AttachedTaskChip } from './AttachedTaskChip';
import { AttachedBacklogItemChip } from './AttachedBacklogItemChip';
import { useAttachments } from '../context/AttachmentsContext';

interface SendFormProps {
  chatroomId: string;
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
    // Mark as mounted and check for touch capability
    setMounted(true);
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
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

export const SendForm = memo(function SendForm({ chatroomId }: SendFormProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isTouchDevice = useIsTouchDevice();

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

  // Attached tasks context
  const { attachedTasks, removeTask, attachedBacklogItems, removeBacklogItem, clearAll } = useAttachments();

  const sendMessage = useSessionMutation(api.messages.send);

  // Auto-resize textarea based on content
  // Use a stable base height to prevent layout shift
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset to auto to get accurate scrollHeight
      textarea.style.height = 'auto';
      // Get the actual scroll height needed for content
      const scrollHeight = textarea.scrollHeight;
      // Set to content height, capped at max (200px) with min of 40px (matches button height)
      const newHeight = Math.max(40, Math.min(scrollHeight, 200));
      textarea.style.height = `${newHeight}px`;
      // Only show overflow when content exceeds max height
      textarea.style.overflowY = scrollHeight > 200 ? 'auto' : 'hidden';
    }
  }, [message]);

  const handleSubmit = useCallback(async () => {
    if (!message.trim() || sending) return;

    setSending(true);
    try {
      await sendMessage({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        senderRole: 'user',
        content: message.trim(),
        type: 'message',
        // Include attached task IDs if any
        ...(attachedTasks.length > 0 && {
          attachedTaskIds: attachedTasks.map((task) => task._id),
        }),
        // Include attached backlog item IDs if any
        ...(attachedBacklogItems.length > 0 && {
          attachedBacklogItemIds: attachedBacklogItems.map((item) => item._id),
        }),
      });
      setMessage('');
      localStorage.removeItem(draftKey);
      // Clear all attachments after successful send
      if (attachedTasks.length > 0 || attachedBacklogItems.length > 0) {
        clearAll();
      }
      // Refocus the textarea after successful send
      // Use setTimeout to ensure focus happens after React re-renders
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  }, [message, sending, sendMessage, chatroomId, attachedTasks, attachedBacklogItems, clearAll, draftKey]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // On touch devices (mobile), Enter creates a newline
      // Submission only happens via the Send button
      if (isTouchDevice) {
        // Allow default behavior (newline) on Enter
        return;
      }

      // On desktop: Enter without Shift sends the message
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      // Shift+Enter allows newline (default behavior)
    },
    [handleSubmit, isTouchDevice]
  );

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      handleSubmit();
    },
    [handleSubmit]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  }, []);

  return (
    <div className="bg-chatroom-bg-surface backdrop-blur-xl border-t-2 border-chatroom-border-strong">
      {/* Attached Tasks Row */}
      {(attachedTasks.length > 0 || attachedBacklogItems.length > 0) && (
        <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
          {attachedTasks.map((task) => (
            <AttachedTaskChip
              key={task._id}
              taskId={task._id}
              content={task.content}
              onRemove={() => removeTask(task._id)}
            />
          ))}
          {attachedBacklogItems.map((item) => (
            <AttachedBacklogItemChip
              key={item._id}
              itemId={item._id}
              content={item.content}
              onRemove={() => removeBacklogItem(item._id)}
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

        <button
          type="submit"
          disabled={!message.trim() || sending}
          className="bg-chatroom-accent text-chatroom-bg-primary border-2 border-chatroom-accent px-5 py-2.5 font-bold text-xs uppercase tracking-wider cursor-pointer transition-all duration-100 hover:bg-chatroom-text-secondary hover:border-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
});
