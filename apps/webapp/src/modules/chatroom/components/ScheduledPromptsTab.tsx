'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Clock, Loader2, Plus } from 'lucide-react';
import React, { useState, useCallback, memo } from 'react';

import { ScheduledPromptCard } from '../features/scheduled-prompts/components/ScheduledPromptCard';
import {
  buildScheduleFields,
  type ScheduleFields,
} from '../features/scheduled-prompts/utils/scheduledPromptFields';
import {
  formatTimezoneLabel,
  utcDailyTimeToLocal,
  utcMsToLocalDateTimeInput,
} from '../features/scheduled-prompts/utils/scheduledPromptTimezone';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ScheduledPromptsTabProps {
  chatroomId: string;
}

export type ScheduledPromptFormData = ScheduleFields & {
  name?: string;
  prompt: string;
};

export const ScheduledPromptsTab = memo(function ScheduledPromptsTab({
  chatroomId,
}: ScheduledPromptsTabProps) {
  const prompts = useSessionQuery(api.scheduledPrompts.list, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });
  const createPrompt = useSessionMutation(api.scheduledPrompts.create);
  const updatePrompt = useSessionMutation(api.scheduledPrompts.update);
  const setEnabled = useSessionMutation(api.scheduledPrompts.setEnabled);
  const removePrompt = useSessionMutation(api.scheduledPrompts.remove);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<Id<'chatroom_scheduledPrompts'> | null>(null);

  const hasPrompts = prompts && prompts.length > 0;
  const editingPrompt = editingId ? prompts?.find((p) => p._id === editingId) : null;

  const handleAdd = useCallback(() => {
    setEditingId(null);
    setShowForm(true);
  }, []);

  const handleEdit = useCallback((id: Id<'chatroom_scheduledPrompts'>) => {
    setEditingId(id);
    setShowForm(true);
  }, []);

  const handleFormClose = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
  }, []);

  const handleFormSave = useCallback(
    async (data: ScheduledPromptFormData) => {
      if (editingId) {
        await updatePrompt({ scheduledPromptId: editingId, ...data });
      } else {
        await createPrompt({ chatroomId: chatroomId as Id<'chatroom_rooms'>, ...data });
      }
      handleFormClose();
    },
    [chatroomId, editingId, createPrompt, updatePrompt, handleFormClose]
  );

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex items-center justify-between">
        {hasPrompts && !showForm && (
          <Button variant="outline" size="sm" onClick={handleAdd} className="text-xs gap-1.5">
            <Plus size={14} />
            Add Scheduled Prompt
          </Button>
        )}
      </div>

      {showForm && (
        <ScheduledPromptForm
          initial={editingPrompt ?? undefined}
          onSave={handleFormSave}
          onCancel={handleFormClose}
        />
      )}

      {hasPrompts && (
        <div className="space-y-3">
          {prompts.map((prompt) => (
            <ScheduledPromptCard
              key={prompt._id}
              prompt={prompt}
              onEdit={handleEdit}
              setEnabled={setEnabled}
              removePrompt={removePrompt}
            />
          ))}
        </div>
      )}

      {prompts === undefined && (
        <div className="flex justify-center py-8">
          <Loader2 size={20} className="animate-spin text-chatroom-text-muted" />
        </div>
      )}

      {!hasPrompts && !showForm && prompts !== undefined && <EmptyState onAdd={handleAdd} />}
    </div>
  );
});

const EmptyState = memo(function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-none bg-chatroom-bg-tertiary flex items-center justify-center mb-4">
        <Clock size={24} className="text-chatroom-text-muted" />
      </div>
      <h3 className="text-sm font-bold text-chatroom-text-primary mb-1">No scheduled prompts</h3>
      <p className="text-xs text-chatroom-text-muted mb-6 max-w-xs">
        Create prompts that fire automatically on an interval, daily, or once at a set time.
      </p>
      <Button variant="outline" size="sm" onClick={onAdd} className="text-xs gap-1.5">
        <Plus size={14} />
        Add Scheduled Prompt
      </Button>
    </div>
  );
});

/** Convex errors carry the user-facing message under `data.message`. */
function firstErrorMessage(err: unknown): string | undefined {
  const e = (err ?? {}) as { data?: { message?: string }; message?: string };
  const dataMessage = e.data && e.data.message;
  return dataMessage || e.message;
}

function saveErrorMessage(err: unknown): string {
  return firstErrorMessage(err) ?? 'Failed to save';
}

/** Prompt content validation shared by every schedule kind. */
function validatePromptContent(prompt: string): string | undefined {
  const trimmed = prompt.trim();
  if (!trimmed) return 'Prompt cannot be empty';
  if (trimmed.length > 10000) return 'Prompt must be 10000 characters or less';
  return undefined;
}

/** The stored runAt to compare against when editing an existing once row. */
function editedOnceRunAt(
  initial: Doc<'chatroom_scheduledPrompts'> | undefined
): number | undefined {
  return initial?.scheduleKind === 'once' ? initial.runAt : undefined;
}

// One controlled form for three schedule kinds; the conditional field groups
// share the same local state, so the branches are inherent to the form.
// fallow-ignore-next-line complexity
const ScheduledPromptForm = memo(function ScheduledPromptForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Doc<'chatroom_scheduledPrompts'>;
  onSave: (data: ScheduledPromptFormData) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [scheduleKind, setScheduleKind] = useState<'interval' | 'daily' | 'once'>(
    initial?.scheduleKind ?? 'interval'
  );
  const [intervalMinutes, setIntervalMinutes] = useState(initial?.intervalMinutes ?? 30);
  const localInit = utcDailyTimeToLocal(initial?.hourUTC ?? 9, initial?.minuteUTC ?? 0);
  const [hourLocal, setHourLocal] = useState(localInit.hour);
  const [minuteLocal, setMinuteLocal] = useState(localInit.minute);
  const [runAtLocal, setRunAtLocal] = useState<string>(
    initial?.runAt !== undefined
      ? utcMsToLocalDateTimeInput(initial.runAt)
      : utcMsToLocalDateTimeInput(Date.now() + 60 * 60_000)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prompt content is validated here; per-kind schedule validation lives in
  // buildScheduleFields. The server stays authoritative for
  // INVALID_SCHEDULE / SCHEDULE_FINISHED.
  const handleSave = useCallback(async () => {
    const contentError = validatePromptContent(prompt);
    if (contentError) {
      setError(contentError);
      return;
    }
    const schedule = buildScheduleFields(scheduleKind, {
      runAtLocal,
      intervalMinutes,
      hour: hourLocal,
      minute: minuteLocal,
      now: Date.now(),
      initialRunAt: editedOnceRunAt(initial),
    });
    if ('error' in schedule) {
      setError(schedule.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim() || undefined,
        prompt: prompt.trim(),
        ...schedule.data,
      });
    } catch (err: any) {
      setError(saveErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [
    name,
    prompt,
    scheduleKind,
    intervalMinutes,
    hourLocal,
    minuteLocal,
    runAtLocal,
    initial,
    onSave,
  ]);

  return (
    <div className="border border-chatroom-border rounded-none bg-chatroom-bg-secondary overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-chatroom-border bg-chatroom-bg-tertiary/50">
        <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary">
          {initial ? 'Edit Scheduled Prompt' : 'New Scheduled Prompt'}
        </span>
      </div>
      <div className="p-4 space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-chatroom-text-primary uppercase tracking-wider">
            Name (optional)
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Daily Standup"
            className="text-xs bg-chatroom-bg-primary border-chatroom-border"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-chatroom-text-primary uppercase tracking-wider">
            Prompt
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the prompt say?"
            rows={3}
            className="w-full text-xs bg-chatroom-bg-primary border border-chatroom-border rounded-none p-2 text-chatroom-text-primary placeholder:text-chatroom-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-chatroom-accent"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-chatroom-text-primary uppercase tracking-wider">
            Schedule
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs text-chatroom-text-primary cursor-pointer">
              <input
                type="radio"
                name="scheduleKind"
                checked={scheduleKind === 'interval'}
                onChange={() => setScheduleKind('interval')}
                className="accent-chatroom-accent"
              />
              Interval
            </label>
            <label className="flex items-center gap-2 text-xs text-chatroom-text-primary cursor-pointer">
              <input
                type="radio"
                name="scheduleKind"
                checked={scheduleKind === 'daily'}
                onChange={() => setScheduleKind('daily')}
                className="accent-chatroom-accent"
              />
              Daily
            </label>
            <label className="flex items-center gap-2 text-xs text-chatroom-text-primary cursor-pointer">
              <input
                type="radio"
                name="scheduleKind"
                checked={scheduleKind === 'once'}
                onChange={() => setScheduleKind('once')}
                className="accent-chatroom-accent"
              />
              One time
            </label>
          </div>
        </div>

        {scheduleKind === 'interval' && (
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-chatroom-text-primary uppercase tracking-wider">
              Every N minutes
            </label>
            <Input
              type="number"
              min={1}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              className="text-xs bg-chatroom-bg-primary border-chatroom-border w-24"
            />
          </div>
        )}

        {scheduleKind === 'daily' && (
          <div className="space-y-2">
            <div className="flex gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-chatroom-text-primary uppercase tracking-wider">
                  Hour
                </label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={hourLocal}
                  onChange={(e) => setHourLocal(Number(e.target.value))}
                  className="text-xs bg-chatroom-bg-primary border-chatroom-border w-20"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-chatroom-text-primary uppercase tracking-wider">
                  Minute
                </label>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={minuteLocal}
                  onChange={(e) => setMinuteLocal(Number(e.target.value))}
                  className="text-xs bg-chatroom-bg-primary border-chatroom-border w-20"
                />
              </div>
            </div>
            <p className="text-[10px] text-chatroom-text-muted">
              Your timezone: {formatTimezoneLabel()}
            </p>
          </div>
        )}

        {scheduleKind === 'once' && (
          <div className="space-y-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-chatroom-text-primary uppercase tracking-wider">
                Date and time
              </label>
              <Input
                type="datetime-local"
                value={runAtLocal}
                min={utcMsToLocalDateTimeInput(Date.now())}
                onChange={(e) => setRunAtLocal(e.target.value)}
                className="text-xs bg-chatroom-bg-primary border-chatroom-border w-64"
              />
            </div>
            <p className="text-[10px] text-chatroom-text-muted">
              Your timezone: {formatTimezoneLabel()}
            </p>
          </div>
        )}

        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} className="text-xs">
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="text-xs gap-1.5">
            {saving ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Saving...
              </>
            ) : initial ? (
              'Save Changes'
            ) : (
              'Create Prompt'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
});
