'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import {
  normalizeTaskEnvelope,
  withTaskEnvelopeConversationMode,
  withTaskEnvelopeSessionPolicy,
  type TaskEnvelopeV1,
} from '@workspace/shared/domain/task-envelope';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Code2, MessageCircle, RotateCcw } from 'lucide-react';
import { useCallback, useState } from 'react';

import type { Message } from '../types/message';

import { cn } from '@/lib/utils';

export interface QueuedMessageEnvelopeControlsProps {
  message: Message;
  compact?: boolean;
  className?: string;
}

type VisibleConversationMode = 'chat' | 'code';

function modeIcon(mode: VisibleConversationMode) {
  switch (mode) {
    case 'chat':
      return <MessageCircle size={14} />;
    case 'code':
      return <Code2 size={14} />;
  }
}

function modeLabel(mode: VisibleConversationMode): string {
  switch (mode) {
    case 'chat':
      return 'Chat';
    case 'code':
      return 'Code';
  }
}

function modeTitle(mode: VisibleConversationMode): string {
  switch (mode) {
    case 'chat':
      return 'Mode: Chat — click to switch to Code.';
    case 'code':
      return 'Mode: Code — click to switch to Chat.';
  }
}

function modeButtonClass(mode: VisibleConversationMode, compact: boolean): string {
  void mode;
  void compact;
  return cn(
    'p-1.5 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50',
    'text-chatroom-text-muted hover:bg-chatroom-bg-hover'
  );
}

function sessionButtonClass(isNew: boolean, compact: boolean): string {
  return cn(
    'p-1.5 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50',
    isNew
      ? 'text-yellow-500 dark:text-yellow-400'
      : compact
        ? 'text-muted-foreground'
        : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover'
  );
}

function sessionTitle(isNew: boolean): string {
  return isNew
    ? 'New session enabled — click to disable.'
    : 'New session disabled — click to enable.';
}

/**
 * Shared stateless editor for a queued message's complete TaskEnvelopeV1 policy.
 *
 * The reactive `message` prop is the source of truth: the current envelope is
 * re-derived from it on every render, the only local state is a pending flag
 * (plus transient error text). A successful mutation lets the Convex query
 * re-render canonical server state; the component never holds optimistic
 * policy state.
 *
 * Event propagation (click / mousedown / keydown) is stopped so the controls
 * never activate an enclosing row (e.g. opening the detail modal) while
 * remaining fully keyboard accessible themselves (native buttons).
 */
export function QueuedMessageEnvelopeControls({
  message,
  compact = false,
  className,
}: QueuedMessageEnvelopeControlsProps) {
  const update = useSessionMutation(api.messages.updateQueuedMessageEnvelope);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = normalizeTaskEnvelope({
    taskEnvelope: message.taskEnvelope,
    conversationMode: message.conversationMode,
    plannerEnhancerEnabled: message.plannerEnhancerEnabled,
    startInNewSession: message.startInNewSession,
  });
  const visibleMode: VisibleConversationMode =
    current.conversationMode === 'chat' ? 'chat' : 'code';

  const stopPropagation = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
  }, []);

  // Guard-and-apply path for one complete envelope write (pending guard,
  // success clears error, failure maps the not-found case to a user-facing line).
  const applyEnvelope = useCallback(
    // fallow-ignore-next-line complexity
    async (next: TaskEnvelopeV1) => {
      // Guard duplicate changes while a mutation is already pending.
      if (isUpdating) return;
      setIsUpdating(true);
      setError(null);
      try {
        await update({
          queuedMessageId: message._id as Id<'chatroom_messageQueue'>,
          taskEnvelope: next,
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        setError(
          /QUEUED_MESSAGE_NOT_FOUND|Queued message not found/i.test(raw)
            ? 'This task has already started.'
            : 'Failed to update queued task settings.'
        );
      } finally {
        setIsUpdating(false);
      }
    },
    [isUpdating, update, message._id]
  );

  const handleModeCycle = useCallback(() => {
    // withTaskEnvelopeConversationMode preserves session policy and resets the
    // workflow to the new mode's default preset + entry phase.
    const next: ConversationMode = visibleMode === 'chat' ? 'code' : 'chat';
    void applyEnvelope(withTaskEnvelopeConversationMode(current, next));
  }, [applyEnvelope, current, visibleMode]);

  const handleSessionToggle = useCallback(() => {
    // withTaskEnvelopeSessionPolicy preserves mode and current workflow.
    const next = current.sessionPolicy === 'new' ? 'continue' : 'new';
    void applyEnvelope(withTaskEnvelopeSessionPolicy(current, next));
  }, [applyEnvelope, current]);

  const isNewSession = current.sessionPolicy === 'new';

  return (
    <div
      className={cn('flex items-center gap-1', className)}
      onClick={stopPropagation}
      onMouseDown={stopPropagation}
      onKeyDown={stopPropagation}
    >
      <button
        type="button"
        data-testid="queued-message-session-toggle"
        aria-pressed={isNewSession}
        aria-busy={isUpdating || undefined}
        disabled={isUpdating}
        title={sessionTitle(isNewSession)}
        onClick={handleSessionToggle}
        className={sessionButtonClass(isNewSession, compact)}
      >
        <RotateCcw size={14} />
      </button>

      <button
        type="button"
        data-testid="queued-message-mode-toggle"
        aria-label={`Mode: ${modeLabel(visibleMode)}`}
        aria-busy={isUpdating || undefined}
        disabled={isUpdating}
        title={modeTitle(visibleMode)}
        onClick={handleModeCycle}
        className={modeButtonClass(visibleMode, compact)}
      >
        {modeIcon(visibleMode)}
      </button>

      {error && (
        <span
          role="alert"
          data-testid="queued-message-envelope-error"
          className="text-xs text-chatroom-status-error"
        >
          {error}
        </span>
      )}
    </div>
  );
}
