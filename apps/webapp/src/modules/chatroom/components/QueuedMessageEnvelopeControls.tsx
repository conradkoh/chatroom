'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import {
  normalizeTaskEnvelope,
  withTaskEnvelopeConversationMode,
  withTaskEnvelopeSessionPolicy,
  type TaskEnvelopeV1,
  type TaskSessionPolicy,
} from '@workspace/shared/domain/task-envelope';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import type { Message } from '../types/message';

import { cn } from '@/lib/utils';

export interface QueuedMessageEnvelopeControlsProps {
  message: Message;
  compact?: boolean;
  className?: string;
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
 * remaining fully keyboard accessible themselves.
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

  const handleModeChange = useCallback(
    (mode: string | null) => {
      // withTaskEnvelopeConversationMode preserves session policy and resets the
      // workflow to the new mode's default preset + entry phase.
      if (!mode) return;
      void applyEnvelope(withTaskEnvelopeConversationMode(current, mode as ConversationMode));
    },
    [applyEnvelope, current]
  );

  const handleSessionChange = useCallback(
    (policy: string | null) => {
      // withTaskEnvelopeSessionPolicy preserves mode and current workflow.
      if (!policy) return;
      void applyEnvelope(withTaskEnvelopeSessionPolicy(current, policy as TaskSessionPolicy));
    },
    [applyEnvelope, current]
  );

  return (
    <div
      className={cn('flex items-center gap-1.5', className)}
      onClick={stopPropagation}
      onMouseDown={stopPropagation}
      onKeyDown={stopPropagation}
    >
      {!compact && (
        <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
          Mode
        </span>
      )}
      <Select
        value={current.conversationMode}
        onValueChange={handleModeChange}
        disabled={isUpdating}
        items={{ chat: 'Chat', code: 'Code', 'code:enhanced': 'Code:Enhanced' }}
      >
        <SelectTrigger size="sm" aria-label="Queued message mode" className="h-7 px-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectItem value="chat">Chat</SelectItem>
          <SelectItem value="code">Code</SelectItem>
          <SelectItem value="code:enhanced">Code:Enhanced</SelectItem>
        </SelectContent>
      </Select>

      {!compact && (
        <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
          Session
        </span>
      )}
      <Select
        value={current.sessionPolicy}
        onValueChange={handleSessionChange}
        disabled={isUpdating}
        items={{ continue: 'Continue', new: 'New session' }}
      >
        <SelectTrigger
          size="sm"
          aria-label="Queued message session policy"
          className="h-7 px-2 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectItem value="continue">Continue</SelectItem>
          <SelectItem value="new">New session</SelectItem>
        </SelectContent>
      </Select>

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
