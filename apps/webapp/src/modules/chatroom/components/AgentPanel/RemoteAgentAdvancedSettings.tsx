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

export interface RemoteAgentAdvancedSettingsProps {
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

export const RemoteAgentAdvancedSettings = memo(function RemoteAgentAdvancedSettings({
  chatroomId,
  role,
  agentHarness,
  wantResumeOnFail = true,
  autoRestartOnNewContext = false,
  disabled = false,
  onWantResumeOnFailChange,
}: RemoteAgentAdvancedSettingsProps) {
  const setWantResumeOnFail = useSessionMutation(api.machines.setWantResumeOnFail);
  const setAutoRestartOnNewContext = useSessionMutation(api.machines.setAutoRestartOnNewContext);

  const [isSavingWantResumeOnFail, setIsSavingWantResumeOnFail] = useState(false);
  const [isSavingAutoRestartOnNewContext, setIsSavingAutoRestartOnNewContext] = useState(false);
  const [localWantResumeOnFail, setLocalWantResumeOnFail] = useState(wantResumeOnFail);
  const [localAutoRestartOnNewContext, setLocalAutoRestartOnNewContext] =
    useState(autoRestartOnNewContext);

  useEffect(() => {
    if (!isSavingWantResumeOnFail) {
      setLocalWantResumeOnFail(wantResumeOnFail);
    }
  }, [wantResumeOnFail, isSavingWantResumeOnFail]);

  useEffect(() => {
    if (!isSavingAutoRestartOnNewContext) {
      setLocalAutoRestartOnNewContext(autoRestartOnNewContext);
    }
  }, [autoRestartOnNewContext, isSavingAutoRestartOnNewContext]);

  const handleWantResumeOnFailChange = useCallback(
    async (checked: boolean) => {
      setLocalWantResumeOnFail(checked);
      onWantResumeOnFailChange?.(checked);
      setIsSavingWantResumeOnFail(true);
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
        setIsSavingWantResumeOnFail(false);
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

  const handleAutoRestartOnNewContextChange = useCallback(
    async (checked: boolean) => {
      setLocalAutoRestartOnNewContext(checked);
      setIsSavingAutoRestartOnNewContext(true);
      try {
        await setAutoRestartOnNewContext({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          enabled: checked,
        });
      } catch (err) {
        setLocalAutoRestartOnNewContext(autoRestartOnNewContext);
        toast.error(
          err instanceof Error ? err.message : 'Failed to update auto-restart setting'
        );
      } finally {
        setIsSavingAutoRestartOnNewContext(false);
      }
    },
    [autoRestartOnNewContext, chatroomId, role, setAutoRestartOnNewContext]
  );

  const showResumeSessionOnFailureSetting =
    agentHarness != null && harnessSupportsSessionResume(agentHarness);
  const showStartNewSessionOnNewContextSetting =
    roleSupportsAutoRestartOnNewContextSetting(role);

  if (!showResumeSessionOnFailureSetting && !showStartNewSessionOnNewContextSetting) {
    return null;
  }

  return (
    <section
      className="mt-3 pt-3 border-t border-chatroom-border"
      aria-label="Advanced remote agent settings"
    >
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
        Advanced
      </h3>
      <ul className="flex flex-col gap-3 list-none p-0 m-0">
        {showResumeSessionOnFailureSetting && (
          <li className="flex items-center justify-between gap-3">
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
              {isSavingWantResumeOnFail && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-chatroom-text-muted" />
              )}
              <Switch
                checked={localWantResumeOnFail}
                disabled={disabled || isSavingWantResumeOnFail}
                onCheckedChange={(checked) => void handleWantResumeOnFailChange(checked)}
                aria-label="Resume session on failure"
              />
            </div>
          </li>
        )}

        {showStartNewSessionOnNewContextSetting && (
          <li className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                Start new session on new context
              </p>
              <p className="text-[10px] text-chatroom-text-secondary mt-0.5">
                Restart this agent when the planner sets a new pinned context
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isSavingAutoRestartOnNewContext && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-chatroom-text-muted" />
              )}
              <Switch
                checked={localAutoRestartOnNewContext}
                disabled={disabled || isSavingAutoRestartOnNewContext}
                onCheckedChange={(checked) => void handleAutoRestartOnNewContextChange(checked)}
                aria-label="Start new session on new context"
              />
            </div>
          </li>
        )}
      </ul>
    </section>
  );
});
