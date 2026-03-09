'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import React, { useState, useMemo, useCallback, useEffect } from 'react';

import { useAgentControls, RemoteTabContent } from './AgentConfigTabs';
import type { AgentPreference } from './AgentConfigTabs';
import type { MachineInfo, AgentConfig } from '../types/machine';

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

  // Fetch machines and configs
  const machinesResult = useSessionQuery(api.machines.listMachines, {}) as
    | { machines: MachineInfo[] }
    | undefined;

  const configsResult = useSessionQuery(api.machines.getMachineAgentConfigs, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as { configs: AgentConfig[] } | undefined;

  const agentPreferencesResult = useSessionQuery(api.machines.getAgentPreferences, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as AgentPreference[] | undefined;

  const saveAgentPreference = useSessionMutation(api.machines.saveAgentPreference);
  const sendCommand = useSessionMutation(api.machines.sendCommand);

  const connectedMachines = useMemo<MachineInfo[]>(() => {
    return machinesResult?.machines.filter((m) => m.daemonConnected) ?? [];
  }, [machinesResult?.machines]);

  const agentConfigs = useMemo<AgentConfig[]>(() => {
    return configsResult?.configs ?? [];
  }, [configsResult?.configs]);

  const isLoadingMachines = machinesResult === undefined || configsResult === undefined;

  // Role selection
  const availableRoles = useMemo<string[]>(() => {
    const fromConfigs = agentConfigs.map((c) => c.role);
    const fromKnown = knownRoles ?? [];
    return [...new Set([...fromConfigs, ...fromKnown])];
  }, [agentConfigs, knownRoles]);

  const [selectedRole, setSelectedRole] = useState<string | null>(initialRole ?? null);

  // Auto-select when exactly one role
  useEffect(() => {
    if (availableRoles.length === 1) {
      setSelectedRole(availableRoles[0]);
    }
  }, [availableRoles]);

  const agentPreference = useMemo<AgentPreference | undefined>(
    () =>
      agentPreferencesResult?.find(
        (p) => p.role.toLowerCase() === (selectedRole ?? '').toLowerCase()
      ),
    [agentPreferencesResult, selectedRole]
  );

  const handleSavePreference = useCallback(
    (pref: AgentPreference) => {
      saveAgentPreference({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role: pref.role,
        machineId: pref.machineId,
        agentHarness: pref.agentHarness,
        model: pref.model,
        workingDir: pref.workingDir,
      }).catch((err) => {
        console.error('[AgentStartModal] Failed to save agent preference:', err);
      });
    },
    [saveAgentPreference, chatroomId]
  );

  // useAgentControls MUST be called unconditionally (rules of hooks)
  const controls = useAgentControls({
    role: selectedRole ?? '',
    chatroomId,
    connectedMachines,
    agentConfigs,
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
        {isLoadingMachines ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-border border-t-foreground rounded-full animate-spin" />
          </div>
        ) : !selectedRole ? (
          <p className="text-muted-foreground text-sm py-4">Select a role to configure.</p>
        ) : (
          <RemoteTabContent
            controls={controls}
            connectedMachines={connectedMachines}
            isLoadingMachines={isLoadingMachines}
            daemonStartCommand={daemonStartCommand}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
