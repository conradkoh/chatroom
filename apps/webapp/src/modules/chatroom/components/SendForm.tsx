'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import React, { useState, useRef, useEffect, useCallback, memo } from 'react';

interface TeamReadiness {
  isReady: boolean;
  expectedRoles: string[];
  missingRoles: string[];
}

interface SendFormProps {
  chatroomId: string;
  readiness: TeamReadiness | null | undefined;
}

/**
 * Hook to detect if the user is on a touch device (likely mobile).
 * Uses touch capability detection rather than screen size for better accuracy.
 */
function useIsTouchDevice() {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    // Check for touch capability
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    setIsTouch(isTouchDevice);
  }, []);

  return isTouch;
}

export const SendForm = memo(function SendForm({ chatroomId, readiness }: SendFormProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isTouchDevice = useIsTouchDevice();

  // Type assertion workaround: The Convex API types are not fully generated
  // until `npx convex dev` is run. This assertion allows us to use the API
  // without full type safety. The correct types will be available after
  // running `npx convex dev` in the backend service.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  const sendMessage = useSessionMutation(chatroomApi.messages.send);

  const isReady = readiness === null || readiness?.isReady;

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message]);

  const handleSubmit = useCallback(async () => {
    if (!message.trim() || sending || !isReady) return;

    setSending(true);
    try {
      await sendMessage({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        senderRole: 'user',
        content: message.trim(),
        type: 'message',
      });
      setMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  }, [message, sending, isReady, sendMessage, chatroomId]);

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
    <form
      className="flex gap-3 p-4 bg-chatroom-bg-surface backdrop-blur-xl border-t-2 border-chatroom-border-strong"
      onSubmit={handleFormSubmit}
    >
      <textarea
        ref={textareaRef}
        value={message}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={
          isReady ? 'Type a message...' : `Waiting for team (${readiness?.missingRoles.join(', ')})`
        }
        disabled={sending}
        rows={1}
        className="flex-1 bg-chatroom-bg-primary border-2 border-chatroom-border text-chatroom-text-primary text-sm p-3 resize-none min-h-[44px] max-h-[200px] placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-border-strong disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <button
        type="submit"
        disabled={!message.trim() || sending || !isReady}
        className="bg-chatroom-accent text-chatroom-bg-primary border-0 px-6 py-3 font-bold text-xs uppercase tracking-widest cursor-pointer transition-all duration-100 hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sending ? 'Sending...' : 'Send'}
      </button>
    </form>
  );
});
