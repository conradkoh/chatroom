'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Clock, Loader2, Plus } from 'lucide-react';
import React, { useState, useCallback, memo } from 'react';

import { ScheduledPromptCard } from '../features/scheduled-prompts/components/ScheduledPromptCard';
import {
  formatTimezoneLabel,
  localDailyTimeToUtc,
  utcDailyTimeToLocal,
} from '../features/scheduled-prompts/utils/scheduledPromptTimezone';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ScheduledPromptsTabProps {
  chatroomId: string;
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
