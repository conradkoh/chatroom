'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useMutation } from 'convex/react';
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

export const SendForm = memo(function SendForm({ chatroomId, readiness }: SendFormProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Type assertion workaround: The Convex API types are not fully generated
  // until `npx convex dev` is run. This assertion allows us to use the API
  // without full type safety. The correct types will be available after
  // running `npx convex dev` in the backend service.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  const sendMessage = useMutation(chatroomApi.messages.send);

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
        chatroomId: chatroomId as Id<'chatrooms'>,
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
      // Enter without Shift sends the message
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      // Shift+Enter allows newline (default behavior)
    },
    [handleSubmit]
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
    <form className="send-form" onSubmit={handleFormSubmit}>
      <textarea
        ref={textareaRef}
        value={message}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={
          isReady
            ? 'Type a message... (Enter to send, Shift+Enter for new line)'
            : `Waiting for team (${readiness?.missingRoles.join(', ')})`
        }
        disabled={sending}
        rows={1}
      />
      <button type="submit" disabled={!message.trim() || sending || !isReady}>
        {sending ? 'Sending...' : 'Send'}
      </button>
    </form>
  );
});
