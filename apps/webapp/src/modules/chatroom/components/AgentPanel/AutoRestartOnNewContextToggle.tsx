'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { roleSupportsAutoRestartOnNewContextSetting } from '@workspace/backend/src/domain/entities/team-agent-settings';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Loader2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';

export interface AutoRestartOnNewContextToggleProps {
  chatroomId: string;
  role: string;
  enabled?: boolean;
}

export const AutoRestartOnNewContextToggle = memo(function AutoRestartOnNewContextToggle({
  chatroomId,
  role,
  enabled = false,
}: AutoRestartOnNewContextToggleProps) {
  const setAutoRestart = useSessionMutation(api.machines.setAutoRestartOnNewContext);
  const [isSaving, setIsSaving] = useState(false);
  const [localEnabled, setLocalEnabled] = useState(enabled);

  useEffect(() => {
    if (!isSaving) {
      setLocalEnabled(enabled);
    }
  }, [enabled, isSaving]);

  const handleToggle = useCallback(
    async (checked: boolean) => {
      setLocalEnabled(checked);
      setIsSaving(true);
      try {
        await setAutoRestart({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          enabled: checked,
        });
      } catch (err) {
        setLocalEnabled(enabled);
        toast.error(
          err instanceof Error ? err.message : 'Failed to update auto-restart setting'
        );
      } finally {
        setIsSaving(false);
      }
    },
    [chatroomId, enabled, role, setAutoRestart]
  );

  if (!roleSupportsAutoRestartOnNewContextSetting(role)) {
    return null;
  }

  return (
    <div className="mt-2 pt-2 border-t border-chatroom-border flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Auto-restart on new context
        </p>
        <p className="text-[10px] text-chatroom-text-secondary mt-0.5">
          Restart this agent when the planner sets a new pinned context
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-chatroom-text-muted" />}
        <Switch
          checked={localEnabled}
          disabled={isSaving}
          onCheckedChange={handleToggle}
          aria-label="Auto-restart on new context"
        />
      </div>
    </div>
  );
});
