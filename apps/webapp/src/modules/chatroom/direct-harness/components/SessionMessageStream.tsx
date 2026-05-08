'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { ExclamationTriangleIcon } from '@radix-ui/react-icons';

import { useHarnessTurnStore } from '../hooks/useHarnessTurnStore';
import { useQueuedMessages } from '../hooks/useQueuedMessages';
import { ThinkingBlock } from './ThinkingBlock';

import { cn } from '@/lib/utils';
import { useScrollController } from '@/modules/chatroom/hooks/useScrollController';

interface SessionMessageStreamProps {
  sessionRowId: Id<'chatroom_harnessSessions'>;
}

const SCROLL_THRESHOLD = 100;

// ─── Component ─────────────────────────────────────────────────────────────────

export function SessionMessageStream({ sessionRowId }: SessionMessageStreamProps) {
  const { turns, isLoading, hasMoreOlder, isLoadingOlder, loadOlderMessages, streamingOverlay } =
    useHarnessTurnStore(sessionRowId);
  const queuedMessages = useQueuedMessages(sessionRowId);

  const { controller } = useScrollController();
  const feedRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef(0);
  const prevTurnCountRef = useRef(0);
  const wasLoadingMoreRef = useRef(false);

  // Ref callback — attach scroll controller to the DOM element
  const feedRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      feedRef.current = node;
      if (node) {
        controller.current.attach(node);
      } else {
        controller.current.detach();
      }
    },
    [controller]
  );

  // Keep wasLoadingMoreRef in sync with isLoadingOlder
  useEffect(() => {
    wasLoadingMoreRef.current = isLoadingOlder;
  }, [isLoadingOlder]);

  // Preserve scroll position when loading older turns prepend content at top
  useLayoutEffect(() => {
    if (feedRef.current) {
      const newScrollHeight = feedRef.current.scrollHeight;
      const heightDiff = newScrollHeight - prevScrollHeightRef.current;
      const turnsAdded = turns.length > prevTurnCountRef.current;

      if (turnsAdded && heightDiff > 0) {
        const wasNearTop = feedRef.current.scrollTop < 200;
        controller.current.onNewMessages(heightDiff, wasLoadingMoreRef.current, wasNearTop);
      }

      prevScrollHeightRef.current = newScrollHeight;
    }
    prevTurnCountRef.current = turns.length;
  }, [turns.length, controller]);

  // Auto-fill: load older turns when content doesn't fill the container
  useEffect(() => {
    if (feedRef.current && hasMoreOlder && !isLoadingOlder) {
      const { scrollHeight, clientHeight } = feedRef.current;
      if (scrollHeight <= clientHeight) {
        loadOlderMessages();
      }
    }
  }, [hasMoreOlder, isLoadingOlder, loadOlderMessages, turns.length]);

  // Scroll handler — load older turns when near the top
  const handleScroll = useCallback(() => {
    const pos = controller.current.getScrollPosition();
    if (pos && hasMoreOlder && !isLoadingOlder && pos.scrollTop < SCROLL_THRESHOLD) {
      loadOlderMessages();
    }
  }, [controller, hasMoreOlder, isLoadingOlder, loadOlderMessages]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (turns.length === 0 && (queuedMessages?.length ?? 0) === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Waiting for response…
      </div>
    );
  }

  const hasQueue = (queuedMessages?.length ?? 0) > 0;

  return (
    <div
      ref={feedRefCallback}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-4"
    >
      {turns.map((turn) => {
        if (turn.role === 'user') {
          return (
            <div key={turn._id} className="flex justify-end">
              <div className="max-w-[75%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap break-words bg-primary text-primary-foreground">
                {turn.textContent}
              </div>
            </div>
          );
        }

        // Assistant turn — check for streaming overlay
        const isStreaming = streamingOverlay !== null && streamingOverlay.turnId === turn._id;

        // Failed turn — render with partial content (if any) + Interrupted badge
        if (turn.status === 'failed') {
          const hasText = turn.textContent.length > 0;
          const hasThinking = turn.reasoningContent.length > 0;
          const hasContent = hasText || hasThinking;

          return (
            <div key={turn._id} className="flex justify-start">
              <div className={cn('max-w-[75%] flex flex-col gap-2')}>
                {hasContent ? (
                  <>
                    {hasThinking && <ThinkingBlock content={turn.reasoningContent} />}
                    {hasText && (
                      <div className="rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm whitespace-pre-wrap break-words bg-muted text-foreground">
                        {turn.textContent}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-2xl rounded-bl-sm px-4 py-2.5 text-xs text-muted-foreground italic bg-muted">
                    No response — interrupted before generation started
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                  <ExclamationTriangleIcon className="size-3" />
                  <span>Interrupted</span>
                </div>
              </div>
            </div>
          );
        }

        // Pending turn with no messageId yet — nothing to show
        if (turn.status === 'pending' && !turn.messageId && !isStreaming) {
          return null;
        }

        const textContent = isStreaming ? streamingOverlay!.textContent : turn.textContent;
        const thinkingContent = isStreaming
          ? streamingOverlay!.reasoningContent
          : turn.reasoningContent;

        const hasThinking = thinkingContent.length > 0;
        const hasText = textContent.length > 0;

        if (!hasThinking && !hasText) return null;

        return (
          <div key={turn._id} className="flex justify-start">
            <div className={cn('max-w-[75%] flex flex-col gap-2')}>
              {hasThinking && <ThinkingBlock content={thinkingContent} />}
              {hasText && (
                <div className="rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm whitespace-pre-wrap break-words bg-muted text-foreground">
                  {textContent}
                </div>
              )}
            </div>
          </div>
        );
      })}

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
    </div>
  );
}
