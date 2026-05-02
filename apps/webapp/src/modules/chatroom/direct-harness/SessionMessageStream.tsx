'use client';

import { useEffect, useRef } from 'react';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionMessageStreamProps {
  sessionRowId: Id<'chatroom_harnessSessions'>;
}

// ─── SessionMessageStream ─────────────────────────────────────────────────────

export function SessionMessageStream({ sessionRowId }: SessionMessageStreamProps) {
  const messages = useSessionQuery(api.chatroom.directHarness.messages.streamSessionMessages, {
    harnessSessionRowId: sessionRowId,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledRef = useRef(false);

  // Reset auto-scroll when session changes
  useEffect(() => {
    isUserScrolledRef.current = false;
  }, [sessionRowId]);

  // Track manual scrolling
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 50;
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

  if (messages === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading messages…
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        No messages yet.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto min-h-0 p-3 space-y-2"
    >
      {messages.map((m) => (
        <div key={m._id} className="px-3 py-2 rounded-md bg-muted text-foreground text-sm whitespace-pre-wrap break-words">
          <div className="text-xs text-muted-foreground mb-1">
            {new Date(m.timestamp).toLocaleTimeString()}
          </div>
          {m.content}
        </div>
      ))}
    </div>
  );
}
