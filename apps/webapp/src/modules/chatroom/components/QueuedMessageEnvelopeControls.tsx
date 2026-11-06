'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { nextConversationMode } from '@workspace/shared/domain/conversation-mode';
import {
  normalizeTaskEnvelope,
  withTaskEnvelopeConversationMode,
  withTaskEnvelopeSessionPolicy,
  type TaskEnvelopeV1,
} from '@workspace/shared/domain/task-envelope';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import type { Message } from '../types/message';
import { ConversationModeButton, SessionPolicyButton } from './shared/EnvelopePolicyButtons';
import { useGuardedWrite } from './shared/useGuardedWrite';

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
 * The icon buttons come from `shared/EnvelopePolicyButtons`; event propagation
 * (click / mousedown / keydown) is stopped here so they never activate an
 * enclosing row (e.g. opening the detail modal).
 */
export function QueuedMessageEnvelopeControls({
  message,
  compact = false,
  className,
}: QueuedMessageEnvelopeControlsProps) {
  const update = useSessionMutation(api.messages.updateQueuedMessageEnvelope);
  const mapError = useCallback((err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err);
    return /QUEUED_MESSAGE_NOT_FOUND|Queued message not found/i.test(raw)
      ? 'This task has already started.'
      : 'Failed to update queued task settings.';
  }, []);
  const { pending: isUpdating, error, run } = useGuardedWrite(mapError);

  const current = normalizeTaskEnvelope({
    taskEnvelope: message.taskEnvelope,
    conversationMode: message.conversationMode,
    startInNewSession: message.startInNewSession,
  });

  const stopPropagation = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
  }, []);

  // Guard-and-apply path for one complete envelope write; the shared hook owns
  // the pending guard and maps failures to a user-facing line.
  const applyEnvelope = useCallback(
    (next: TaskEnvelopeV1) => {
      void run(() =>
        update({
          queuedMessageId: message._id as Id<'chatroom_messageQueue'>,
          taskEnvelope: next,
        })
      );
    },
    [run, update, message._id]
  );

  const handleModeCycle = useCallback(() => {
    // withTaskEnvelopeConversationMode preserves session policy and resets the
    // workflow to the new mode's default preset + entry phase.
    void applyEnvelope(
      withTaskEnvelopeConversationMode(current, nextConversationMode(current.conversationMode))
    );
  }, [applyEnvelope, current]);

  const handleSessionToggle = useCallback(() => {
    // withTaskEnvelopeSessionPolicy preserves mode and current workflow.
    const next = current.sessionPolicy === 'new' ? 'continue' : 'new';
    void applyEnvelope(withTaskEnvelopeSessionPolicy(current, next));
  }, [applyEnvelope, current]);

  return (
    <div
      className={cn('flex items-center gap-1', className)}
      onClick={stopPropagation}
      onMouseDown={stopPropagation}
      onKeyDown={stopPropagation}
    >
      <SessionPolicyButton
        testId="queued-message-session-toggle"
        isNewSession={current.sessionPolicy === 'new'}
        pending={isUpdating}
        onToggle={handleSessionToggle}
        compact={compact}
      />

      <ConversationModeButton
        testId="queued-message-mode-toggle"
        mode={current.conversationMode}
        pending={isUpdating}
        onCycle={handleModeCycle}
      />

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
