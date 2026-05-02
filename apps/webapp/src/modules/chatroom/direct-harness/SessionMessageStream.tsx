'use client';

/**
 * SessionMessageStream — renders messages from a harness session reactively.
 *
 * Auto-scrolls to bottom on new messages unless the user has scrolled up.
 */

import { useEffect, useRef } from 'react';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { api } from '@workspace/backend/convex/_generated/api';

interface SessionMessageStreamProps {
  sessionId: string;
}

export function SessionMessageStream({ sessionId }: SessionMessageStreamProps) {
  const messages = useSessionQuery(api.chatroom.directHarness.messages.streamSessionMessages, {
    harnessSessionRowId: sessionId as Id<'chatroom_harnessSessions'>,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledRef = useRef(false);

  // Track manual scrolling
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 50; // px from bottom
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isUserScrolledRef.current = !isAtBottom;
  };

  // Auto-scroll to bottom when new messages arrive (unless user scrolled up)
  useEffect(() => {
    if (isUserScrolledRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  if (!messages || messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground min-h-16">
        No messages yet. Send a prompt below.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto space-y-1.5 min-h-0 max-h-48 pr-1"
    >
      {messages.map((msg) => (
        <div
          key={msg._id}
          className="px-2 py-1.5 rounded-sm bg-muted dark:bg-muted/70 text-xs text-foreground whitespace-pre-wrap break-words"
        >
          {msg.content}
        </div>
      ))}
    </div>
  );
}
