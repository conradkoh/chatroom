'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel';
import { nextConversationMode } from '@workspace/shared/domain/conversation-mode';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import {
  ConversationModeButton,
  SessionPolicyButton,
} from '../../../components/shared/EnvelopePolicyButtons';
import { useGuardedWrite } from '../../../components/shared/useGuardedWrite';
import { WorkQueueDeleteButton } from '../../../components/shared/WorkQueueDeleteButton';
import { WorkQueueRow } from '../../../components/shared/WorkQueueRow';
import { WorkQueuePreviewText } from '../../../components/WorkQueue/WorkQueuePreviewText';
import { formatTimestampFull } from '../../../utils/chatroomTimestamp';
import {
  formatSchedule,
  formatUpcomingRun,
  scheduledPromptActionErrorMessage,
} from '../utils/scheduledPromptFormat';
import { scheduledPromptPolicy } from '../utils/scheduledPromptPolicy';

const UPDATE_FALLBACK = 'Could not update the schedule. Try again.';
const DELETE_FALLBACK = 'Could not delete. Try again.';

export interface ScheduledPromptSidebarRowProps {
  prompt: Doc<'chatroom_scheduledPrompts'>;
  /** Deletes the prompt. Rejections are shown on the row. */
  onDelete: (id: Id<'chatroom_scheduledPrompts'>) => Promise<unknown>;
  onOpen: () => void;
}

function promptTitle(prompt: Doc<'chatroom_scheduledPrompts'>): string {
  return prompt.name?.trim() || prompt.prompt;
}

function scheduleLabel(prompt: Doc<'chatroom_scheduledPrompts'>): string {
  return prompt.scheduleKind === 'once' ? 'Once' : formatSchedule(prompt);
}

function runLabel(nextRunAt: number | undefined): string {
  return nextRunAt !== undefined ? formatUpcomingRun(nextRunAt) : '—';
}

function metaTitle(nextRunAt: number | undefined): string | undefined {
  return nextRunAt !== undefined ? formatTimestampFull(nextRunAt) : undefined;
}

function describePrompt(prompt: Doc<'chatroom_scheduledPrompts'>) {
  const nextRunAt = prompt.nextRunAt;
  return {
    title: promptTitle(prompt),
    meta: `${scheduleLabel(prompt)} · ${runLabel(nextRunAt)}`,
    metaTitle: metaTitle(nextRunAt),
  };
}

/** One guarded policy write at a time; the query re-renders canonical state. */
function usePolicyWrites(prompt: Doc<'chatroom_scheduledPrompts'>) {
  const updatePolicy = useSessionMutation(api.scheduledPrompts.updatePolicy);
  const mapError = useCallback(
    (e: unknown) => scheduledPromptActionErrorMessage(e, UPDATE_FALLBACK),
    []
  );
  const { pending, error, setError, run } = useGuardedWrite(mapError);
  const envelope = scheduledPromptPolicy(prompt);

  const onToggleSession = useCallback(() => {
    const sessionPolicy = envelope.sessionPolicy === 'new' ? 'continue' : 'new';
    void run(() => updatePolicy({ scheduledPromptId: prompt._id, sessionPolicy }));
  }, [run, updatePolicy, prompt._id, envelope.sessionPolicy]);

  const onCycleMode = useCallback(() => {
    const conversationMode = nextConversationMode(envelope.conversationMode);
    void run(() => updatePolicy({ scheduledPromptId: prompt._id, conversationMode }));
  }, [run, updatePolicy, prompt._id, envelope.conversationMode]);

  return { envelope, pending, error, setError, onToggleSession, onCycleMode };
}

/** Delete is single-tap; a rejection is shown inline and can be retried. */
function useDelete(
  id: Id<'chatroom_scheduledPrompts'>,
  onDelete: (id: Id<'chatroom_scheduledPrompts'>) => Promise<unknown>,
  setError: (value: string | null) => void
) {
  return useCallback(async () => {
    setError(null);
    try {
      await onDelete(id);
    } catch (e) {
      setError(scheduledPromptActionErrorMessage(e, DELETE_FALLBACK));
    }
  }, [id, onDelete, setError]);
}

function RowMeta({
  meta,
  metaTitleText,
  error,
}: {
  meta: string;
  metaTitleText?: string;
  error: string | null;
}) {
  return (
    <>
      <span className="block truncate" title={metaTitleText}>
        {meta}
      </span>
      {error && (
        <span
          role="alert"
          data-testid="scheduled-prompt-sidebar-error"
          className="mt-0.5 block text-[10px] text-chatroom-status-error break-words"
        >
          {error}
        </span>
      )}
    </>
  );
}

/**
 * Scheduled-sidebar row: a thin adapter over the shared work-queue row. The
 * reactive `prompt` prop is the source of truth; session and mode writes send
 * only their own field.
 */
export function ScheduledPromptSidebarRow({
  prompt,
  onDelete,
  onOpen,
}: ScheduledPromptSidebarRowProps) {
  const { envelope, pending, error, setError, onToggleSession, onCycleMode } =
    usePolicyWrites(prompt);
  const handleDelete = useDelete(prompt._id, onDelete, setError);
  const { title, meta, metaTitle: metaTitleText } = describePrompt(prompt);

  return (
    <WorkQueueRow
      preview={<WorkQueuePreviewText content={title} />}
      meta={<RowMeta meta={meta} metaTitleText={metaTitleText} error={error} />}
      onOpen={onOpen}
      actions={
        <>
          <SessionPolicyButton
            compact
            testId="scheduled-prompt-session-toggle"
            isNewSession={envelope.sessionPolicy === 'new'}
            pending={pending}
            onToggle={onToggleSession}
          />
          <ConversationModeButton
            testId="scheduled-prompt-mode-toggle"
            mode={envelope.conversationMode}
            pending={pending}
            onCycle={onCycleMode}
          />
          <WorkQueueDeleteButton onDelete={handleDelete} />
        </>
      }
    />
  );
}
