'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';

import { useAgentControls } from './AgentConfigTabs';
import type { AgentPreference } from './AgentConfigTabs';
import { useAgentPanelData } from '../hooks/useAgentPanelData';
import type { AgentRoleView } from '../hooks/useAgentPanelData';
import { useAgentStatuses } from '../hooks/useAgentStatuses';
import { AgentStatusRow } from './AgentPanel/AgentStatusRow';
import { AgentControlsSection } from './AgentPanel/AgentControlsSection';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getDaemonStartCommand } from '@/lib/environment';

interface AgentStartModalProps {
  chatroomId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-select a specific role when the modal opens. */
  initialRole?: string;
  /** Team roles to show in the role picker when no agent config exists yet. */
  knownRoles?: string[];
  /**
   * Optional: pre-generated prompt for the selected role's Custom tab.
   * When not provided (e.g. when rendered outside PromptsProvider), the
   * Custom tab renders with empty content — which is acceptable.
   */
  prompt?: string;
  /**
   * Optional: map of role → AgentRoleView for team-config hints (model, harness).
   * Used by useAgentControls to pre-fill the model/harness fields when no saved
   * preference exists. Callers that have the team config (e.g. ChatroomSidebar)
   * should build this map and pass it in.
   */
  agentRoleViewMap?: Map<string, AgentRoleView>;
}

/**
 * Standalone modal for starting/stopping a remote agent in a chatroom.
 * Rebuilt to use chatroom theme classes and shared components (AgentStatusRow,
 * AgentControlsSection) for visual consistency with InlineAgentCard.
 */
export function AgentStartModal({ chatroomId, open, onOpenChange, initialRole, knownRoles, prompt = '', agentRoleViewMap }: AgentStartModalProps) {
  const daemonStartCommand = getDaemonStartCommand();

  const {
    teamRoles,
    connectedMachines,
    machineConfigs,
    isLoading,
    sendCommand,
    savePreference,
  } = useAgentPanelData(chatroomId);

  // Role selection — prioritize explicit knownRoles, then teamRoles, then machineConfigs
  const availableRoles = useMemo<string[]>(() => {
    if (knownRoles && knownRoles.length > 0) return knownRoles;
    if (teamRoles.length > 0) return teamRoles;
    return machineConfigs.map((c) => c.role);
  }, [knownRoles, teamRoles, machineConfigs]);

  const [selectedRole, setSelectedRole] = useState<string | null>(initialRole ?? null);

  // Auto-select when exactly one role
  useEffect(() => {
    if (availableRoles.length === 1) {
      setSelectedRole(availableRoles[0]);
    }
  }, [availableRoles]);

  // Use getAgentStartConfig for form defaults
  const startConfig = useSessionQuery(
    api.machines.getAgentStartConfig,
    selectedRole
      ? {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role: selectedRole,
        }
      : 'skip'
  );

  // Build agent preference from server-computed defaults
  const agentPreference = useMemo<AgentPreference | undefined>(() => {
    if (!startConfig?.defaults || !selectedRole) return undefined;
    const d = startConfig.defaults;
    if (!d.machineId || !d.agentHarness) return undefined;
    return {
      role: selectedRole,
      machineId: d.machineId,
      agentHarness: d.agentHarness as AgentPreference['agentHarness'],
      model: d.model,
      workingDir: d.workingDir,
    };
  }, [startConfig, selectedRole]);

  const handleSavePreference = useCallback(
    (pref: AgentPreference) => {
      savePreference(pref);
    },
    [savePreference]
  );

  // Resolve team-level agent config for the selected role (for model/harness hints)
  const selectedAgentRoleView = selectedRole
    ? agentRoleViewMap?.get(selectedRole.toLowerCase())
    : undefined;

  // useAgentControls MUST be called unconditionally (rules of hooks)
  const controls = useAgentControls({
    role: selectedRole ?? '',
    chatroomId,
    connectedMachines,
    agentConfigs: machineConfigs,
    sendCommand,
    teamConfigModel: selectedAgentRoleView?.model,
    teamConfigHarness: selectedAgentRoleView?.agentHarness,
    agentPreference,
    onSavePreference: handleSavePreference,
  });

  // Live status for the selected role — always hook at top level (rules of hooks)
  const roleForStatus = useMemo(
    () => (selectedRole ? [selectedRole] : []),
    [selectedRole]
  );
  const { agents: agentStatusList } = useAgentStatuses(chatroomId, roleForStatus);
  const agentStatus = selectedRole
    ? agentStatusList.find((a) => a.role.toLowerCase() === selectedRole.toLowerCase())
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="chatroom-root max-w-lg bg-chatroom-bg-primary border-chatroom-border p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-4 py-3 border-b border-chatroom-border">
          <DialogTitle className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
            Start Agent
          </DialogTitle>
        </DialogHeader>

        {/* Role picker — only shown if multiple roles exist */}
        {availableRoles.length > 1 && (
          <div className="flex gap-2 flex-wrap px-4 py-3 border-b border-chatroom-border">
            {availableRoles.map((role) => (
              <button
                key={role}
                onClick={() => setSelectedRole(role)}
                className={`text-[11px] font-bold uppercase tracking-wide border-b-2 pb-0.5 transition-colors ${
                  selectedRole === role
                    ? 'border-chatroom-accent text-chatroom-text-primary'
                    : 'border-transparent text-chatroom-text-muted hover:text-chatroom-text-secondary'
                }`}
              >
                {role}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
          </div>
        ) : !selectedRole ? (
          <p className="text-chatroom-text-muted text-xs py-4 px-4">Select a role to configure.</p>
        ) : (
          <div className="px-4 py-3 flex flex-col gap-3">
            {/* Live status for the selected role */}
            <AgentStatusRow
              role={selectedRole}
              online={agentStatus?.online ?? false}
              statusLabel={agentStatus?.statusLabel ?? 'OFFLINE'}
              statusVariant={agentStatus?.statusVariant}
              lastSeenAt={agentStatus?.lastSeenAt}
            />

            {/* Remote + Custom tabs via shared component */}
            <AgentControlsSection
              controls={controls}
              connectedMachines={connectedMachines}
              isLoadingMachines={isLoading}
              daemonStartCommand={daemonStartCommand}
              role={selectedRole}
              prompt={prompt}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
