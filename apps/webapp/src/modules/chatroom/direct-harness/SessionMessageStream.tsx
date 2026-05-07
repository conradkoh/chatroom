'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useSubscribeMessages } from './hooks/useSubscribeMessages';

interface SessionMessageStreamProps {
  sessionRowId: Id<'chatroom_harnessSessions'>;
}

export function SessionMessageStream({ sessionRowId }: SessionMessageStreamProps) {
  const messages = useSubscribeMessages({ harnessSessionId: sessionRowId });
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledRef = useRef(false);

  // Reset scroll-lock when session changes
  useEffect(() => {
    isUserScrolledRef.current = false;
  }, [sessionRowId]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    isUserScrolledRef.current = !atBottom;
  };

  // Auto-scroll on new messages unless user scrolled up
  useEffect(() => {
    if (isUserScrolledRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  if (messages === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Waiting for response…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-4"
    >
      {messages.map((m) => {
        const isUser = m.role === 'user';
        return (
          <div
            key={m._id}
            className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words',
                isUser
                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                  : 'bg-muted text-foreground rounded-bl-sm'
              )}
            >
              {m.content}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
