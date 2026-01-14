'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { MessageSquare } from 'lucide-react';
import React, { useEffect, useRef, useMemo, memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { WorkingIndicator } from './WorkingIndicator';

interface Participant {
  _id?: string;
  role: string;
  status: string;
}

interface MessageFeedProps {
  chatroomId: string;
  participants: Participant[];
}

interface Message {
  _id: string;
  type: string;
  senderRole: string;
  targetRole?: string;
  content: string;
  _creationTime: number;
}

// Memoized message item to prevent re-renders of all messages when one changes
const MessageItem = memo(function MessageItem({ message }: { message: Message }) {
  return (
    <div className="message-item">
      <div className="message-header">
        <div>
          {message.type !== 'message' && (
            <span className={`message-type ${message.type}`}>{message.type}</span>
          )}
          <span
            className={`message-sender ${
              message.senderRole === 'user'
                ? 'user'
                : message.senderRole === 'system'
                  ? 'system'
                  : ''
            }`}
          >
            {message.senderRole}
          </span>
          {message.targetRole && <span className="message-target">{message.targetRole}</span>}
        </div>
        <span className="message-time">{formatTime(message._creationTime)}</span>
      </div>
      <div className="message-content markdown-content">
        <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
      </div>
    </div>
  );
});

export const MessageFeed = memo(function MessageFeed({
  chatroomId,
  participants,
}: MessageFeedProps) {
  // Type assertion workaround: The Convex API types are not fully generated
  // until `npx convex dev` is run. This assertion allows us to use the API
  // without full type safety. The correct types will be available after
  // running `npx convex dev` in the backend service.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  const messages = useSessionQuery(chatroomApi.messages.list, {
    chatroomId: chatroomId as Id<'chatrooms'>,
  }) as Message[] | undefined;

  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages]);

  // Filter out join messages - memoized
  const displayMessages = useMemo(
    () => (messages || []).filter((m) => m.type !== 'join'),
    [messages]
  );

  if (messages === undefined) {
    return (
      <div className="message-feed">
        <div className="empty-state">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (displayMessages.length === 0) {
    return (
      <div className="message-feed">
        <div className="empty-state">
          <div className="empty-state-icon">
            <MessageSquare size={32} />
          </div>
          <div>No messages yet</div>
          <div style={{ color: 'var(--text-muted)', marginTop: 8 }}>
            Send a message to get started
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="message-feed" ref={feedRef}>
      {displayMessages.map((message) => (
        <MessageItem key={message._id} message={message} />
      ))}
      <WorkingIndicator participants={participants} />
    </div>
  );
});

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
