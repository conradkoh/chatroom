'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { roleSupportsAutoRestartOnNewContextSetting } from '@workspace/backend/src/domain/entities/team-agent-settings';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Loader2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { AgentHarness } from '../../types/machine';
import { harnessSupportsSessionResume } from '../../types/machine';

import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export interface RemoteAgentBehaviorSettingsProps {
  chatroomId: string;
  role: string;
  /** Harness used for resume-on-failure visibility (selected or running). */
  agentHarness: AgentHarness | null;
  wantResumeOnFail?: boolean;
  autoRestartOnNewContext?: boolean;
  disabled?: boolean;
  /** Called when resume-on-failure changes so start commands use the latest value. */
  onWantResumeOnFailChange?: (enabled: boolean) => void;
}

export const RemoteAgentBehaviorSettings = memo(function RemoteAgentBehaviorSettings({
  chatroomId,
  role,
  agentHarness,
  wantResumeOnFail = true,
  autoRestartOnNewContext = false,
  disabled = false,
  onWantResumeOnFailChange,
}: RemoteAgentBehaviorSettingsProps) {
  const setWantResumeOnFail = useSessionMutation(api.machines.setWantResumeOnFail);
  const setAutoRestart = useSessionMutation(api.machines.setAutoRestartOnNewContext);

  const [isSavingResume, setIsSavingResume] = useState(false);
  const [isSavingAutoRestart, setIsSavingAutoRestart] = useState(false);
  const [localWantResumeOnFail, setLocalWantResumeOnFail] = useState(wantResumeOnFail);
  const [localAutoRestart, setLocalAutoRestart] = useState(autoRestartOnNewContext);

  useEffect(() => {
    if (!isSavingResume) {
      setLocalWantResumeOnFail(wantResumeOnFail);
    }
  }, [wantResumeOnFail, isSavingResume]);

  useEffect(() => {
    if (!isSavingAutoRestart) {
      setLocalAutoRestart(autoRestartOnNewContext);
    }
  }, [autoRestartOnNewContext, isSavingAutoRestart]);

  const handleWantResumeOnFailChange = useCallback(
    async (checked: boolean) => {
      setLocalWantResumeOnFail(checked);
      onWantResumeOnFailChange?.(checked);
      setIsSavingResume(true);
      try {
        await setWantResumeOnFail({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          enabled: checked,
        });
      } catch (err) {
        setLocalWantResumeOnFail(wantResumeOnFail);
        onWantResumeOnFailChange?.(wantResumeOnFail);
        toast.error(
          err instanceof Error ? err.message : 'Failed to update resume-on-failure setting'
        );
      } finally {
        setIsSavingResume(false);
      }
    },
    [
      chatroomId,
      onWantResumeOnFailChange,
      role,
      setWantResumeOnFail,
      wantResumeOnFail,
    ]
  );

  const handleAutoRestartChange = useCallback(
    async (checked: boolean) => {
      setLocalAutoRestart(checked);
      setIsSavingAutoRestart(true);
      try {
        await setAutoRestart({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          enabled: checked,
        });
      } catch (err) {
        setLocalAutoRestart(autoRestartOnNewContext);
        toast.error(
          err instanceof Error ? err.message : 'Failed to update auto-restart setting'
        );
      } finally {
        setIsSavingAutoRestart(false);
      }
    },
    [autoRestartOnNewContext, chatroomId, role, setAutoRestart]
  );

  const showResumeOnFail =
    agentHarness != null && harnessSupportsSessionResume(agentHarness);
  const showAutoRestartOnNewContext = roleSupportsAutoRestartOnNewContextSetting(role);

  if (!showResumeOnFail && !showAutoRestartOnNewContext) {
    return null;
  }

  return (
    <div className="mt-2 pt-2 border-t border-chatroom-border flex flex-col gap-3">
      {showResumeOnFail && (
        <div className="flex items-center justify-between gap-3">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="min-w-0 cursor-default">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                    Resume session on failure
                  </p>
                  <p className="text-[10px] text-chatroom-text-secondary mt-0.5">
                    After a failed turn, keep the harness session and retry instead of killing
                    the agent
                  </p>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px] text-xs">
                Applies when the agent exits a turn without a clean stop — not when you press
                Start (that always spawns fresh).
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isSavingResume && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-chatroom-text-muted" />
            )}
            <Switch
              checked={localWantResumeOnFail}
              disabled={disabled || isSavingResume}
              onCheckedChange={(checked) => void handleWantResumeOnFailChange(checked)}
              aria-label="Resume session on failure"
            />
          </div>
        </div>
      )}

      {showAutoRestartOnNewContext && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
              Start new session on new context
            </p>
            <p className="text-[10px] text-chatroom-text-secondary mt-0.5">
              Restart this agent when the planner sets a new pinned context
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isSavingAutoRestart && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-chatroom-text-muted" />
            )}
            <Switch
              checked={localAutoRestart}
              disabled={disabled || isSavingAutoRestart}
              onCheckedChange={(checked) => void handleAutoRestartChange(checked)}
              aria-label="Start new session on new context"
            />
          </div>
        </div>
      )}
    </div>
  );
});
