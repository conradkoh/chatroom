'use client';

import { roleSupportsAutoRestartOnNewContextSetting } from '@workspace/backend/src/domain/entities/team-agent-settings';
import { Loader2 } from 'lucide-react';
import { memo } from 'react';

import type { AgentHarness } from '../../types/machine';
import { harnessSupportsDaemonMemoryResume } from '../../types/machine';

import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export interface RemoteAgentAdvancedSettingsProps {
  role: string;
  agentHarness: AgentHarness | null;
  resumeSession: boolean;
  autoRestartOnNewContext: boolean;
  disabled?: boolean;
  isSavingAutoRestartOnNewContext?: boolean;
  isSavingWantResume?: boolean;
  onResumeSessionChange: (enabled: boolean) => void;
  onAutoRestartOnNewContextChange: (enabled: boolean) => void;
}

// fallow-ignore-next-line complexity
export const RemoteAgentAdvancedSettings = memo(function RemoteAgentAdvancedSettings({
  role,
  agentHarness,
  resumeSession,
  autoRestartOnNewContext,
  disabled = false,
  isSavingAutoRestartOnNewContext = false,
  isSavingWantResume = false,
  onResumeSessionChange,
  onAutoRestartOnNewContextChange,
}: RemoteAgentAdvancedSettingsProps) {
  const showResumeSessionSetting =
    agentHarness != null && harnessSupportsDaemonMemoryResume(agentHarness);
  const showStartNewSessionOnNewContextSetting = roleSupportsAutoRestartOnNewContextSetting(role);

  if (!showResumeSessionSetting && !showStartNewSessionOnNewContextSetting) {
    return null;
  }

  return (
    <section
      className="mt-3 pt-3 border-t border-chatroom-border"
      aria-label="Advanced remote agent settings"
    >
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted mb-2">
        Advanced
      </h3>
      <ul className="flex flex-col gap-3 list-none p-0 m-0 pl-2.5 border-l border-chatroom-border/70">
        {showResumeSessionSetting && (
          <li className="flex items-center justify-between gap-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="min-w-0 cursor-default">
                    <p className="text-[11px] font-medium leading-snug text-chatroom-text-primary">
                      Reconnect to last session
                    </p>
                    <p className="text-[10px] text-chatroom-text-secondary mt-0.5">
                      On Start, reuse the daemon&apos;s preserved session instead of a cold start
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[240px] text-xs">
                  Applies when you Start after stopping this agent on the same machine. The daemon
                  must still have session metadata in memory.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isSavingWantResume && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-chatroom-text-muted" />
              )}
              <Switch
                checked={resumeSession}
                disabled={disabled || isSavingWantResume}
                onCheckedChange={onResumeSessionChange}
                aria-label="Reconnect to last session"
              />
            </div>
          </li>
        )}

        {showStartNewSessionOnNewContextSetting && (
          <li className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium leading-snug text-chatroom-text-primary">
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
                checked={autoRestartOnNewContext}
                disabled={disabled || isSavingAutoRestartOnNewContext}
                onCheckedChange={onAutoRestartOnNewContextChange}
                aria-label="Start new session on new context"
              />
            </div>
          </li>
        )}
      </ul>
    </section>
  );
});
