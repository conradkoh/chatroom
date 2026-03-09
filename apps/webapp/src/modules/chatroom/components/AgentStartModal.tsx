'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';

import { useAgentControls, RemoteTabContent } from './AgentConfigTabs';
import type { AgentPreference } from './AgentConfigTabs';
import { useAgentPanelData } from '../hooks/useAgentPanelData';

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
}

/**
 * Standalone modal for starting/stopping a remote agent in a chatroom.
 * Fetches its own data — requires only chatroomId, open, onOpenChange.
 */
export function AgentStartModal({ chatroomId, open, onOpenChange, initialRole, knownRoles }: AgentStartModalProps) {
  const daemonStartCommand = getDaemonStartCommand();

  const {
    teamRoles,
    connectedMachines,
    machineConfigs,
    isLoading,
    sendCommand,
    savePreference,
  } = useAgentPanelData(chatroomId);

  // Role selection — use teamRoles from getAgentStatus, with fallback to machineConfigs + knownRoles
  const availableRoles = useMemo<string[]>(() => {
    const fromTeam = teamRoles;
    const fromConfigs = machineConfigs.map((c) => c.role);
    const fromKnown = knownRoles ?? [];
    return [...new Set([...fromTeam, ...fromConfigs, ...fromKnown])];
  }, [teamRoles, machineConfigs, knownRoles]);

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

  // useAgentControls MUST be called unconditionally (rules of hooks)
  const controls = useAgentControls({
    role: selectedRole ?? '',
    chatroomId,
    connectedMachines,
    agentConfigs: machineConfigs,
    sendCommand,
    agentPreference,
    onSavePreference: handleSavePreference,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xs font-bold uppercase tracking-widest">
            Start Agent
          </DialogTitle>
        </DialogHeader>

        {/* Role picker — only shown if multiple roles exist */}
        {availableRoles.length > 1 && (
          <div className="flex gap-2 flex-wrap border-b border-border pb-3 mb-1">
            {availableRoles.map((role) => (
              <button
                key={role}
                onClick={() => setSelectedRole(role)}
                className={`px-3 py-1 text-xs font-bold uppercase tracking-wider rounded border transition-colors ${
                  selectedRole === role
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-transparent text-muted-foreground border-border hover:border-foreground hover:text-foreground'
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
            <div className="w-5 h-5 border-2 border-border border-t-foreground rounded-full animate-spin" />
          </div>
        ) : !selectedRole ? (
          <p className="text-muted-foreground text-sm py-4">Select a role to configure.</p>
        ) : (
          <RemoteTabContent
            controls={controls}
            connectedMachines={connectedMachines}
            isLoadingMachines={isLoading}
            daemonStartCommand={daemonStartCommand}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
