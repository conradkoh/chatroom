'use client';

import { Loader2 } from 'lucide-react';
import { memo } from 'react';

import type { AgentHarness } from '../../types/machine';
import { shouldShowResumeSessionToggle } from '../../utils/wantResumeDefaults';

import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export interface RemoteAgentAdvancedSettingsProps {
  role: string;
  teamId?: string;
  agentHarness: AgentHarness | null;
  resumeSession: boolean;
  disabled?: boolean;
  isSavingWantResume?: boolean;
  onResumeSessionChange: (enabled: boolean) => void;
  plannerRestartOnHandoffToUser?: boolean;
  isSavingPlannerRestart?: boolean;
  onPlannerRestartOnHandoffToUserChange?: (enabled: boolean) => void;
}

export const RemoteAgentAdvancedSettings = memo(function RemoteAgentAdvancedSettings({
  role,
  teamId,
  agentHarness,
  resumeSession,
  disabled = false,
  isSavingWantResume = false,
  onResumeSessionChange,
  plannerRestartOnHandoffToUser = true,
  isSavingPlannerRestart = false,
  onPlannerRestartOnHandoffToUserChange,
}: RemoteAgentAdvancedSettingsProps) {
  const showResumeSessionSetting = shouldShowResumeSessionToggle(teamId, role, agentHarness);

  if (!showResumeSessionSetting) {
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
        <li className="flex items-center justify-between gap-3">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<div className="min-w-0 cursor-default" />}>
                <p className="text-[11px] font-medium leading-snug text-chatroom-text-primary">
                  Reconnect to last session
                </p>
                <p className="text-[10px] text-chatroom-text-secondary mt-0.5">
                  On Start, reuse the daemon&apos;s preserved session instead of a cold start
                </p>
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
        {role.toLowerCase() === 'planner' && (
          <li className="flex items-center justify-between gap-3">
            <TooltipProvider><Tooltip><TooltipTrigger render={<div className="min-w-0 cursor-default" />}>
              <p className="text-[11px] font-medium leading-snug text-chatroom-text-primary">Restart session after user handoff</p>
              <p className="text-[10px] text-chatroom-text-secondary mt-0.5">Experimental — start a fresh planner session each time you deliver to the user</p>
            </TooltipTrigger><TooltipContent side="top" className="max-w-[240px] text-xs">Experimental — enabled by default; disable if context preservation works better for you</TooltipContent></Tooltip></TooltipProvider>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isSavingPlannerRestart && <Loader2 className="h-3.5 w-3.5 animate-spin text-chatroom-text-muted" />}
              <Switch checked={plannerRestartOnHandoffToUser} disabled={disabled || isSavingPlannerRestart} onCheckedChange={onPlannerRestartOnHandoffToUserChange} aria-label="Restart session after user handoff" />
            </div>
          </li>
        )}
      </ul>
    </section>
  );
});
