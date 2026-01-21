'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import React, { useState, useRef, useEffect, useCallback, memo } from 'react';

import { AttachedTaskChip } from './AttachedTaskChip';
import { useAttachedTasks } from '../context/AttachedTasksContext';

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

export const SendForm = memo(function SendForm({ chatroomId }: SendFormProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isTouchDevice = useIsTouchDevice();

  // Attached tasks context
  const { attachedTasks, removeTask, clearTasks } = useAttachedTasks();

  // Type assertion workaround: The Convex API types are not fully generated
  // until `npx convex dev` is run. This assertion allows us to use the API
  // without full type safety. The correct types will be available after
  // running `npx convex dev` in the backend service.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  const sendMessage = useSessionMutation(chatroomApi.messages.send);

  // Auto-resize textarea based on content
  // Use a stable base height to prevent layout shift
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset to auto to get accurate scrollHeight
      textarea.style.height = 'auto';
      // Get the actual scroll height needed for content
      const scrollHeight = textarea.scrollHeight;
      // Set to content height, capped at max (200px) with min of 36px
      const newHeight = Math.max(36, Math.min(scrollHeight, 200));
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
      });
      setMessage('');
      // Clear attached tasks after successful send
      if (attachedTasks.length > 0) {
        clearTasks();
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  }, [message, sending, sendMessage, chatroomId, attachedTasks, clearTasks]);

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
      {attachedTasks.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
          {attachedTasks.map((task) => (
            <AttachedTaskChip
              key={task._id}
              taskId={task._id}
              content={task.content}
              onRemove={() => removeTask(task._id)}
            />
          ))}
        </div>
      )}
      {/* Input Form */}
      <form className="flex gap-3 p-4" onSubmit={handleFormSubmit}>
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={sending}
          rows={1}
          className="flex-1 bg-chatroom-bg-primary border-2 border-chatroom-border text-chatroom-text-primary text-sm px-3 py-2 resize-none max-h-[200px] overflow-hidden leading-5 placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-border-strong disabled:opacity-50 disabled:cursor-not-allowed"
        />

        <button
          type="submit"
          disabled={!message.trim() || sending}
          className="bg-chatroom-accent text-chatroom-bg-primary border-0 px-6 py-3 font-bold text-xs uppercase tracking-widest cursor-pointer transition-all duration-100 hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
});
