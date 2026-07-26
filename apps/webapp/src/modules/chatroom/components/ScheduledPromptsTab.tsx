'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Clock, Loader2, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import React, { useState, useCallback, memo } from 'react';

import {
  formatDailyScheduleLocal,
  formatTimestampLocal,
  formatTimezoneLabel,
  localDailyTimeToUtc,
  utcDailyTimeToLocal,
} from '../features/scheduled-prompts/utils/scheduledPromptTimezone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

interface ScheduledPromptsTabProps {
  chatroomId: string;
}

function formatSchedule(prompt: {
  scheduleKind: 'interval' | 'daily';
  intervalMinutes?: number;
  hourUTC?: number;
  minuteUTC?: number;
}): string {
  if (prompt.scheduleKind === 'interval') return `Every ${prompt.intervalMinutes} minutes`;
  return formatDailyScheduleLocal(prompt.hourUTC ?? 0, prompt.minuteUTC ?? 0);
}

function formatTime(ts: number): string {
  return formatTimestampLocal(ts);
}

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
    async (data: {
      name?: string;
      prompt: string;
      scheduleKind: 'interval' | 'daily';
      intervalMinutes?: number;
      hourUTC?: number;
      minuteUTC?: number;
    }) => {
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
    <div className="space-y-6">
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
          initial={editingPrompt}
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
        Create prompts that fire automatically on an interval or daily schedule.
      </p>
      <Button variant="outline" size="sm" onClick={onAdd} className="text-xs gap-1.5">
        <Plus size={14} />
        Add Scheduled Prompt
      </Button>
    </div>
  );
});

const ScheduledPromptCard = memo(function ScheduledPromptCard({
  prompt,
  onEdit,
  setEnabled,
  removePrompt,
}: {
  prompt: any;
  onEdit: (id: Id<'chatroom_scheduledPrompts'>) => void;
  setEnabled: any;
  removePrompt: any;
}) {
  const [isToggling, setIsToggling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isArchiveDisabled = prompt.disabledReason === 'archive';
  const isActive = prompt.disabledReason === undefined;

  const handleToggle = useCallback(async () => {
    setIsToggling(true);
    try {
      await setEnabled({ scheduledPromptId: prompt._id, enabled: !isActive });
    } finally {
      setIsToggling(false);
    }
  }, [prompt._id, isActive, setEnabled]);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await removePrompt({ scheduledPromptId: prompt._id });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [prompt._id, removePrompt]);

  const displayName =
    prompt.name || prompt.prompt.slice(0, 60) + (prompt.prompt.length > 60 ? '...' : '');

  return (
    <div className="border border-chatroom-border rounded-none p-4 bg-chatroom-bg-secondary">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-chatroom-text-primary truncate">
              {displayName}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-none text-[10px] font-bold uppercase tracking-wider ${
                isActive
                  ? 'bg-green-500/10 text-green-500 dark:bg-green-500/20 dark:text-green-400'
                  : isArchiveDisabled
                    ? 'bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400'
                    : 'bg-chatroom-bg-tertiary text-chatroom-text-muted'
              }`}
            >
              {isActive ? (
                <>
                  <Power size={10} />
                  Active
                </>
              ) : isArchiveDisabled ? (
                'Disabled by archive'
              ) : (
                <>
                  <PowerOff size={10} />
                  Disabled
                </>
              )}
            </span>
          </div>
          <p className="text-xs text-chatroom-text-primary truncate">{prompt.prompt}</p>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[11px] text-chatroom-text-muted">{formatSchedule(prompt)}</span>
            {prompt.lastRunAt && (
              <span className="text-[11px] text-chatroom-text-muted">
                Last run: {formatTime(prompt.lastRunAt)}
              </span>
            )}
            {prompt.nextRunAt && isActive && (
              <span className="text-[11px] text-chatroom-text-muted">
                Next run: {formatTime(prompt.nextRunAt)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-4">
          <Switch
            checked={isActive}
            onCheckedChange={handleToggle}
            disabled={isToggling || isArchiveDisabled}
          />
          {!isArchiveDisabled && (
            <>
              {showDeleteConfirm ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="text-xs h-7 px-2"
                  >
                    {isDeleting ? <Loader2 size={12} className="animate-spin" /> : 'Delete'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="text-xs h-7 px-2"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(prompt._id)}
                    className="text-xs h-7 px-2 text-chatroom-text-muted hover:text-chatroom-accent"
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="text-chatroom-text-muted hover:text-red-500 dark:hover:text-red-400 h-7 w-7 p-0"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

const ScheduledPromptForm = memo(function ScheduledPromptForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: any;
  onSave: (data: {
    name?: string;
    prompt: string;
    scheduleKind: 'interval' | 'daily';
    intervalMinutes?: number;
    hourUTC?: number;
    minuteUTC?: number;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [scheduleKind, setScheduleKind] = useState<'interval' | 'daily'>(
    initial?.scheduleKind ?? 'interval'
  );
  const [intervalMinutes, setIntervalMinutes] = useState(initial?.intervalMinutes ?? 30);
  const localInit = utcDailyTimeToLocal(initial?.hourUTC ?? 9, initial?.minuteUTC ?? 0);
  const [hourLocal, setHourLocal] = useState(localInit.hour);
  const [minuteLocal, setMinuteLocal] = useState(localInit.minute);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!prompt.trim()) {
      setError('Prompt cannot be empty');
      return;
    }
    if (prompt.trim().length > 10000) {
      setError('Prompt must be 10000 characters or less');
      return;
    }
    if (scheduleKind === 'interval' && (!intervalMinutes || intervalMinutes < 1)) {
      setError('Interval must be at least 1 minute');
      return;
    }
    if (
      scheduleKind === 'daily' &&
      (hourLocal === undefined ||
        minuteLocal === undefined ||
        hourLocal < 0 ||
        hourLocal > 23 ||
        minuteLocal < 0 ||
        minuteLocal > 59)
    ) {
      setError('Daily schedule requires valid hour (0-23) and minute (0-59)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data: any = {
        name: name.trim() || undefined,
        prompt: prompt.trim(),
        scheduleKind,
      };
      if (scheduleKind === 'interval') {
        data.intervalMinutes = intervalMinutes;
      } else {
        const { hourUTC, minuteUTC } = localDailyTimeToUtc(hourLocal, minuteLocal);
        data.hourUTC = hourUTC;
        data.minuteUTC = minuteUTC;
      }
      await onSave(data);
    } catch (err: any) {
      setError(err?.data?.message ?? err?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [name, prompt, scheduleKind, intervalMinutes, hourLocal, minuteLocal, onSave]);

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
          </div>
        </div>

        {scheduleKind === 'interval' ? (
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
        ) : (
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
