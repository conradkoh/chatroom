'use client';

import type { AgentRoleView } from '@workspace/backend/src/domain/usecase/chatroom/get-agent-statuses';
import { FolderOpen, ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';

import { InlineAgentCard } from './InlineAgentCard';
import type { AgentWithStatus } from './UnifiedAgentListModal';
import type { MachineInfo, AgentConfig, SendCommandFn } from '../../types/machine';
import type { Workspace } from '../../types/workspace';
import { WorkspaceGitPanel } from '../../workspace/components/WorkspaceGitPanel';
import type { AgentPreference } from '../AgentConfigTabs';

import { cn } from '@/lib/utils';

interface WorkspaceAgentListProps {
  workspace: Workspace | null;
  agents: AgentWithStatus[];
  generatePrompt: (role: string) => string;
  chatroomId: string;
  connectedMachines: MachineInfo[];
  isLoadingMachines: boolean;
  agentConfigs: AgentConfig[];
  sendCommand: SendCommandFn;
  agentRoleViewMap: Map<string, AgentRoleView>;
  agentPreferenceMap: Map<string, AgentPreference>;
  onSavePreference: (pref: AgentPreference) => void;
}

/** Renders workspace details + filtered InlineAgentCard rows for the selected workspace. */
export const WorkspaceAgentList = memo(function WorkspaceAgentList({
  workspace,
  agents,
  generatePrompt,
  chatroomId,
  connectedMachines,
  isLoadingMachines,
  agentConfigs,
  sendCommand,
  agentRoleViewMap,
  agentPreferenceMap,
  onSavePreference,
}: WorkspaceAgentListProps) {
  const [gitExpanded, setGitExpanded] = useState(false);
  if (!workspace) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-xs text-chatroom-text-muted uppercase tracking-wide">
          Select a workspace
        </p>
      </div>
    );
  }

  // Filter agents to only those in the selected workspace
  const workspaceAgents = agents.filter((a) => workspace.agentRoles.includes(a.role));

  const dirLabel = workspace.workingDir
    ? (workspace.workingDir.split('/').filter(Boolean).pop() ?? workspace.workingDir)
    : 'Unassigned';

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Workspace details header — fixed, does not scroll */}
      <div className="border-b-2 border-chatroom-border px-4 pt-4 pb-3 flex-shrink-0 space-y-3">
        {/* Section label */}
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Workspace
        </div>

        {/* Primary identity: folder icon + name + path */}
        <div className="flex items-start gap-2.5">
          <FolderOpen size={18} className="text-chatroom-text-secondary flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-base font-bold text-chatroom-text-primary leading-tight truncate">
              {dirLabel}
            </div>
            <div className="text-[10px] font-mono text-chatroom-text-muted mt-0.5 truncate">
              {workspace.workingDir || '—'}
            </div>
          </div>
        </div>

        {/* Metadata row: machine + agent count as key-value pairs */}
        <div className="flex items-start gap-3 pl-[30px]">
          {workspace.machineId && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                Machine
              </span>
              <span className="text-[11px] font-bold text-chatroom-text-secondary uppercase tracking-wide">
                {workspace.hostname}
              </span>
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-chatroom-text-muted">
              Agents
            </span>
            <span className="text-[11px] font-bold text-chatroom-text-secondary">
              {workspace.agentRoles.length}
            </span>
          </div>
        </div>
      </div>

      {/* Git panel — collapsible */}
      {workspace.machineId && workspace.workingDir && (
        <div className="border-b border-chatroom-border flex-shrink-0">
          <button
            type="button"
            onClick={() => setGitExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-1.5 hover:bg-chatroom-bg-hover transition-colors"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
              Git
            </span>
            <ChevronRight
              size={12}
              className={cn(
                'text-chatroom-text-muted transition-transform',
                gitExpanded && 'rotate-90'
              )}
            />
          </button>
          {gitExpanded && (
            <div className="px-4 pb-3">
              <WorkspaceGitPanel
                machineId={workspace.machineId}
                workingDir={workspace.workingDir}
              />
            </div>
          )}
        </div>
      )}

      {/* "AGENTS" section label — pinned, does not scroll */}
      {workspaceAgents.length > 0 && (
        <div className="px-4 py-2 border-b border-chatroom-border flex-shrink-0 bg-chatroom-bg-surface">
          <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
            Agents
          </span>
        </div>
      )}

      {/* Agent list — scrollable */}
      {workspaceAgents.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <p className="text-xs text-chatroom-text-muted uppercase tracking-wide">
            No agents in this workspace
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {workspaceAgents.map(
            ({ role, online, lastSeenAt, latestEventType, desiredState, statusVariant }) => (
              <InlineAgentCard
                key={role}
                role={role}
                online={online}
                lastSeenAt={lastSeenAt}
                latestEventType={latestEventType}
                desiredState={desiredState}
                statusVariant={statusVariant}
                prompt={generatePrompt(role)}
                chatroomId={chatroomId}
                connectedMachines={connectedMachines}
                isLoadingMachines={isLoadingMachines}
                agentConfigs={agentConfigs}
                sendCommand={sendCommand}
                agentRoleView={agentRoleViewMap.get(role.toLowerCase())}
                agentPreference={agentPreferenceMap.get(role.toLowerCase())}
                onSavePreference={onSavePreference}
              />
            )
          )}
        </div>
      )}
    </div>
  );
});
