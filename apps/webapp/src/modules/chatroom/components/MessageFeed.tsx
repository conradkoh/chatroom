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
  classification?: 'question' | 'new_feature' | 'follow_up';
}

// Message type badge styling
const getMessageTypeBadge = (type: string) => {
  const base = 'inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 mr-2';
  switch (type) {
    case 'handoff':
      return `${base} bg-purple-400/15 text-chatroom-status-purple`;
    case 'interrupt':
      return `${base} bg-red-400/15 text-chatroom-status-error`;
    case 'join':
      return `${base} bg-emerald-400/15 text-chatroom-status-success`;
    default:
      return base;
  }
};

// Sender role styling
const getSenderClasses = (role: string) => {
  const base = 'font-bold text-xs uppercase tracking-wide';
  if (role === 'user') return `${base} text-chatroom-status-success`;
  if (role === 'system') return `${base} text-chatroom-status-warning`;
  return `${base} text-chatroom-status-info`;
};

// Classification badge styling
const getClassificationBadge = (classification: Message['classification']) => {
  if (!classification) return null;
  const base = 'inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 ml-2';
  switch (classification) {
    case 'question':
      return { className: `${base} bg-cyan-400/15 text-cyan-400`, label: 'question' };
    case 'new_feature':
      return { className: `${base} bg-amber-400/15 text-amber-400`, label: 'new feature' };
    case 'follow_up':
      return { className: `${base} bg-zinc-400/15 text-zinc-400`, label: 'follow-up' };
    default:
      return null;
  }
};

// Memoized message item to prevent re-renders of all messages when one changes
const MessageItem = memo(function MessageItem({ message }: { message: Message }) {
  const classificationBadge = getClassificationBadge(message.classification);

  return (
    <div className="px-4 py-3 bg-transparent border-b-2 border-chatroom-border transition-all duration-100 hover:bg-chatroom-accent-subtle hover:-mx-2 hover:px-6 last:border-b-0">
      {/* Message Header */}
      <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-chatroom-border">
        <div className="flex items-center flex-wrap gap-y-1">
          {message.type !== 'message' && (
            <span className={getMessageTypeBadge(message.type)}>{message.type}</span>
          )}
          <span className={getSenderClasses(message.senderRole)}>{message.senderRole}</span>
          {message.targetRole && (
            <span className="text-chatroom-text-muted text-[10px] font-bold uppercase tracking-wide ml-2 before:content-['→_'] before:text-chatroom-text-muted">
              {message.targetRole}
            </span>
          )}
          {/* Show classification badge for user messages */}
          {message.senderRole.toLowerCase() === 'user' && classificationBadge && (
            <span className={classificationBadge.className}>{classificationBadge.label}</span>
          )}
        </div>
        <span className="text-[10px] font-mono font-bold tabular-nums text-chatroom-text-muted">
          {formatTime(message._creationTime)}
        </span>
      </div>
      {/* Message Content */}
      <div className="text-chatroom-text-primary text-[13px] leading-relaxed break-words prose prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-code:bg-chatroom-bg-primary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-chatroom-status-success prose-code:text-[0.9em] prose-pre:bg-chatroom-bg-primary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-primary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-primary prose-blockquote:text-chatroom-text-secondary">
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
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as Message[] | undefined;

  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTo({
        top: feedRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages]);

  // Filter out join messages - memoized
  const displayMessages = useMemo(
    () => (messages || []).filter((m) => m.type !== 'join'),
    [messages]
  );

  if (messages === undefined) {
    return (
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="flex flex-col items-center justify-center h-full text-chatroom-text-muted">
          <div className="w-8 h-8 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
        </div>
      </div>
    );
  }

  if (displayMessages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="flex flex-col items-center justify-center h-full text-chatroom-text-muted">
          <div className="text-5xl mb-4">
            <MessageSquare size={32} />
          </div>
          <div>No messages yet</div>
          <div className="text-chatroom-text-muted mt-2">Send a message to get started</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-y-auto p-4 min-h-0 scrollbar-thin scrollbar-track-chatroom-bg-primary scrollbar-thumb-chatroom-border"
      ref={feedRef}
    >
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
