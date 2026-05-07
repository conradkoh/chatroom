'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useSubscribeMessages } from './hooks/useSubscribeMessages';
import type { HarnessMessage } from './hooks/useSubscribeMessages';
import { useQueuedMessages } from './hooks/useQueuedMessages';
import { ThinkingBlock } from './ThinkingBlock';

interface SessionMessageStreamProps {
  sessionRowId: Id<'chatroom_harnessSessions'>;
}

// ─── Turn grouping ─────────────────────────────────────────────────────────────

type UserTurn = {
  key: string;
  role: 'user';
  minSeq: number;
  content: string;
};

type AssistantTurn = {
  key: string;
  role: 'assistant';
  minSeq: number;
  /** Concatenated reasoning (thinking) tokens for this turn. */
  thinkingContent: string;
  /** Concatenated regular text tokens for this turn. */
  textContent: string;
};

type TurnGroup = UserTurn | AssistantTurn;

/**
 * Groups the flat per-token message rows into display turns.
 *
 * - User rows: one turn each.
 * - Assistant rows with a messageId: all rows sharing the same messageId
 *   are merged into one turn, split by partType (text vs. reasoning).
 * - Assistant rows without a messageId (legacy): consecutive rows are merged
 *   together, matching the pre-Phase-2 behaviour.
 *
 * Turns are sorted by their minimum seq so an agent turn that started before
 * a user message always sorts before that user message, even if some of the
 * agent's tokens were flushed after the user message was stored.
 */
function buildTurnGroups(messages: HarnessMessage[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  // Deduplicates assistant turns by messageId
  const seenMessageIds = new Map<string, AssistantTurn>();
  // Tracks the current run of legacy (no-messageId) assistant rows
  let legacyRun: AssistantTurn | null = null;

  for (const msg of messages) {
    if (msg.role === 'user') {
      legacyRun = null;
      groups.push({ key: msg._id, role: 'user', minSeq: msg.seq, content: msg.content });
    } else if (msg.messageId) {
      // Named assistant turn — group by messageId across the whole stream
      legacyRun = null;
      let turn = seenMessageIds.get(msg.messageId);
      if (!turn) {
        turn = { key: msg.messageId, role: 'assistant', minSeq: msg.seq, thinkingContent: '', textContent: '' };
        seenMessageIds.set(msg.messageId, turn);
        groups.push(turn);
      }
      // Keep the minimum seq so sorting works correctly when tokens are interleaved
      if (msg.seq < turn.minSeq) turn.minSeq = msg.seq;
      if (msg.partType === 'reasoning') {
        turn.thinkingContent += msg.content;
      } else {
        turn.textContent += msg.content;
      }
    } else {
      // Legacy assistant row (no messageId) — consecutive merge
      if (!legacyRun) {
        legacyRun = { key: `legacy-${msg._id}`, role: 'assistant', minSeq: msg.seq, thinkingContent: '', textContent: '' };
        groups.push(legacyRun);
      }
      if (msg.seq < legacyRun.minSeq) legacyRun.minSeq = msg.seq;
      legacyRun.textContent += msg.content;
    }
  }

  // Sort by minSeq so named turns that started early sort before later user
  // messages even when their trailing tokens arrived after those user messages.
  groups.sort((a, b) => a.minSeq - b.minSeq);

  return groups;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function SessionMessageStream({ sessionRowId }: SessionMessageStreamProps) {
  const messages = useSubscribeMessages({ harnessSessionId: sessionRowId });
  const queuedMessages = useQueuedMessages(sessionRowId);
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

  // Auto-scroll on new tokens unless the user has scrolled up
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

  if (messages.length === 0 && (queuedMessages?.length ?? 0) === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Waiting for response…
      </div>
    );
  }

  const turns = buildTurnGroups(messages);
  const hasQueue = (queuedMessages?.length ?? 0) > 0;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-4"
    >
      {turns.map((turn) => {
        if (turn.role === 'user') {
          return (
            <div key={turn.key} className="flex justify-end">
              <div className="max-w-[75%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap break-words bg-primary text-primary-foreground">
                {turn.content}
              </div>
            </div>
          );
        }

        const hasThinking = turn.thinkingContent.length > 0;
        const hasText = turn.textContent.length > 0;

        return (
          <div key={turn.key} className="flex justify-start">
            <div className={cn('max-w-[75%] flex flex-col gap-2')}>
              {hasThinking && <ThinkingBlock content={turn.thinkingContent} />}
              {hasText && (
                <div className="rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm whitespace-pre-wrap break-words bg-muted text-foreground">
                  {turn.textContent}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Queued messages — held while work is in flight */}
      {hasQueue && (
        <div className="flex flex-col gap-2">
          {queuedMessages!.map((qm) => (
            <div key={qm._id} className="flex justify-end">
              <div className="max-w-[75%] flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">Queued</span>
                <div className="rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap break-words bg-primary/40 text-primary-foreground/70">
                  {qm.content}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
