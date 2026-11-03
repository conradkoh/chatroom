'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel';
import { nextConversationMode } from '@workspace/shared/domain/conversation-mode';
import { normalizeTaskEnvelope, type TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import {
  ConversationModeButton,
  SessionPolicyButton,
} from '../../../components/shared/EnvelopePolicyButtons';
import { formatTimestampFull } from '../../../utils/chatroomTimestamp';
import {
  formatSchedule,
  formatUpcomingRun,
  scheduledPromptActionErrorMessage,
} from '../utils/scheduledPromptFormat';

import { cn } from '@/lib/utils';

const UPDATE_FALLBACK = 'Could not update the schedule. Try again.';
const DELETE_FALLBACK = 'Could not delete. Try again.';

const DELETE_IDLE_CLASS =
  'p-1.5 rounded transition-colors disabled:opacity-50 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400';
const DELETE_ARMED_CLASS =
  'p-1.5 rounded transition-colors disabled:opacity-50 bg-red-600 text-white dark:bg-red-500';

export interface ScheduledPromptSidebarRowProps {
  prompt: Doc<'chatroom_scheduledPrompts'>;
  deleteArmed: boolean;
  onRequestDelete: (id: Id<'chatroom_scheduledPrompts'>) => void | Promise<void>;
  onOpen: () => void;
}

/** One guarded write at a time; the query re-renders the canonical policy. */
async function runGuarded(
  isPending: boolean,
  setPending: (value: boolean) => void,
  setError: (value: string | null) => void,
  fn: () => Promise<unknown>,
  fallback: string
): Promise<void> {
  if (isPending) return;
  setPending(true);
  setError(null);
  try {
    await fn();
  } catch (e) {
    setError(scheduledPromptActionErrorMessage(e, fallback));
  } finally {
    setPending(false);
  }
}

/** In-flight flag plus inline error for the row's mutations. */
function useGuardedRun() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    (fn: () => Promise<unknown>, fallback: string) => {
      void runGuarded(pending, setPending, setError, fn, fallback);
    },
    [pending]
  );
  return { pending, error, run };
}

/**
 * Row actions. The reactive `prompt` prop is the source of truth; the row never
 * invents a policy, so legacy rows read as code + new session.
 */
function useScheduledPolicyActions({
  prompt,
  deleteArmed,
  onRequestDelete,
}: Pick<ScheduledPromptSidebarRowProps, 'prompt' | 'deleteArmed' | 'onRequestDelete'>): {
  envelope: TaskEnvelopeV1;
  pending: boolean;
  error: string | null;
  onToggleSession: () => void;
  onCycleMode: () => void;
  onDelete: () => void;
} {
  const updatePolicy = useSessionMutation(api.scheduledPrompts.updatePolicy);
  const { pending, error, run } = useGuardedRun();
  const envelope = normalizeTaskEnvelope({
    taskEnvelope: prompt.taskEnvelope,
    startInNewSession: true,
  });

  const onToggleSession = useCallback(() => {
    const sessionPolicy = envelope.sessionPolicy === 'new' ? 'continue' : 'new';
    run(() => updatePolicy({ scheduledPromptId: prompt._id, sessionPolicy }), UPDATE_FALLBACK);
  }, [run, updatePolicy, prompt._id, envelope.sessionPolicy]);

  const onCycleMode = useCallback(() => {
    const conversationMode = nextConversationMode(envelope.conversationMode);
    run(() => updatePolicy({ scheduledPromptId: prompt._id, conversationMode }), UPDATE_FALLBACK);
  }, [run, updatePolicy, prompt._id, envelope.conversationMode]);

  const onDelete = useCallback(() => {
    // The parent owns arming: a first tap only arms, a second tap deletes.
    if (!deleteArmed) {
      onRequestDelete(prompt._id);
      return;
    }
    run(() => Promise.resolve(onRequestDelete(prompt._id)), DELETE_FALLBACK);
  }, [run, deleteArmed, onRequestDelete, prompt._id]);

  return { envelope, pending, error, onToggleSession, onCycleMode, onDelete };
}

function rowTitle(prompt: Doc<'chatroom_scheduledPrompts'>): string {
  return prompt.name?.trim() || prompt.prompt;
}

function rowScheduleLabel(prompt: Doc<'chatroom_scheduledPrompts'>): string {
  return prompt.scheduleKind === 'once' ? 'Once' : formatSchedule(prompt);
}

function rowRunLabel(nextRunAt: number | undefined): string {
  return nextRunAt !== undefined ? formatUpcomingRun(nextRunAt) : '—';
}

function rowMetaTitle(nextRunAt: number | undefined): string | undefined {
  return nextRunAt !== undefined ? formatTimestampFull(nextRunAt) : undefined;
}

function describeRow(prompt: Doc<'chatroom_scheduledPrompts'>) {
  const nextRunAt = prompt.nextRunAt;
  return {
    title: rowTitle(prompt),
    meta: `${rowScheduleLabel(prompt)} · ${rowRunLabel(nextRunAt)}`,
    metaTitle: rowMetaTitle(nextRunAt),
  };
}

function deletePresentation(title: string, armed: boolean) {
  return armed
    ? {
        label: `Confirm delete ${title}`,
        title: 'Click again to delete',
        className: DELETE_ARMED_CLASS,
      }
    : { label: `Delete ${title}`, title: 'Delete', className: DELETE_IDLE_CLASS };
}

function RowText({
  title,
  meta,
  metaTitle,
  error,
}: {
  title: string;
  meta: string;
  metaTitle?: string;
  error: string | null;
}) {
  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs text-chatroom-text-primary truncate" title={title}>
        {title}
      </p>
      <p className="text-[10px] text-muted-foreground mt-0.5 truncate" title={metaTitle}>
        {meta}
      </p>
      {error && (
        <p
          role="alert"
          data-testid="scheduled-prompt-sidebar-error"
          className="mt-0.5 text-[10px] text-chatroom-status-error break-words"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function DeleteScheduleButton({
  label,
  title,
  className,
  pending,
  onClick,
}: {
  label: string;
  title: string;
  className: string;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="scheduled-prompt-delete"
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={label}
      title={title}
      onClick={onClick}
      className={cn(className)}
    >
      <Trash2 size={14} aria-hidden />
    </button>
  );
}

export function ScheduledPromptSidebarRow({
  prompt,
  deleteArmed,
  onRequestDelete,
  onOpen,
}: ScheduledPromptSidebarRowProps) {
  const { envelope, pending, error, onToggleSession, onCycleMode, onDelete } =
    useScheduledPolicyActions({ prompt, deleteArmed, onRequestDelete });
  const { title, meta, metaTitle } = describeRow(prompt);
  const del = deletePresentation(title, deleteArmed);

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="scheduled-prompt-sidebar-row"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
      className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors cursor-pointer text-left w-full"
    >
      <RowText title={title} meta={meta} metaTitle={metaTitle} error={error} />
      <div
        className="flex shrink-0 items-center gap-1"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <SessionPolicyButton
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
        <DeleteScheduleButton
          label={del.label}
          title={del.title}
          className={del.className}
          pending={pending}
          onClick={onDelete}
        />
      </div>
    </div>
  );
}
