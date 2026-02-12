'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Settings, Users, Server, Check, AlertTriangle } from 'lucide-react';
import React, { useState, useCallback, memo, useEffect, useMemo, useRef } from 'react';

import { CopyButton } from './CopyButton';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
  FixedModalSidebar,
} from '@/components/ui/fixed-modal';
import { usePrompts } from '@/contexts/PromptsContext';

// ─── Types ──────────────────────────────────────────────────────────────

interface TeamDefinition {
  name: string;
  description: string;
  roles: string[];
  entryPoint?: string;
}

interface TeamsConfig {
  defaultTeam: string;
  teams: Record<string, TeamDefinition>;
}

interface AgentSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  currentTeamId?: string;
  currentTeamName?: string;
  currentTeamRoles?: string[];
  currentTeamEntryPoint?: string;
}

type SettingsTab = 'setup' | 'team' | 'machine';

// ─── Constants ──────────────────────────────────────────────────────────

// Available teams (matching CreateChatroomForm and CLI defaults)
const TEAMS_CONFIG: TeamsConfig = {
  defaultTeam: 'pair',
  teams: {
    pair: {
      name: 'Pair',
      description: 'A builder and reviewer working together',
      roles: ['builder', 'reviewer'],
      entryPoint: 'builder',
    },
    squad: {
      name: 'Squad',
      description: 'A planner, builder, and reviewer working as a coordinated team',
      roles: ['planner', 'builder', 'reviewer'],
      entryPoint: 'planner',
    },
  },
};

const TAB_CONFIG: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'setup', label: 'Setup', icon: <Settings size={16} /> },
  { id: 'team', label: 'Team', icon: <Users size={16} /> },
  { id: 'machine', label: 'Machine', icon: <Server size={16} /> },
];

// ─── Tab Content Components ─────────────────────────────────────────────

/**
 * Setup tab — shows the chatroom ID and basic setup information
 */
const SetupContent = memo(function SetupContent({ chatroomId }: { chatroomId: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(chatroomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [chatroomId]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary mb-1">
          Chatroom Setup
        </h3>
        <p className="text-xs text-chatroom-text-muted">
          Basic chatroom configuration and identification.
        </p>
      </div>

      {/* Chatroom ID */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Chatroom ID
        </label>
        <div className="flex items-center gap-2">
          <div className="flex-1 font-mono text-[11px] font-bold text-chatroom-text-secondary break-all p-3 bg-chatroom-bg-tertiary border border-chatroom-border">
            {chatroomId}
          </div>
          <button
            onClick={handleCopy}
            className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide border border-chatroom-border text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Environment variable */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Connection Command
        </label>
        <div className="font-mono text-[10px] text-chatroom-text-secondary break-all p-3 bg-chatroom-bg-tertiary border border-chatroom-border leading-relaxed">
          chatroom wait-for-task --chatroom-id={chatroomId} --role=&lt;role&gt;
        </div>
      </div>
    </div>
  );
});

/**
 * Team Configuration tab — allows switching the team type
 */
const TeamConfigContent = memo(function TeamConfigContent({
  chatroomId,
  currentTeamId,
  currentTeamRoles,
}: {
  chatroomId: string;
  currentTeamId?: string;
  currentTeamRoles?: string[];
}) {
  const [selectedTeam, setSelectedTeam] = useState<string>(currentTeamId || 'pair');
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null);

  const updateTeam = useSessionMutation(api.chatrooms.updateTeam);

  const hasChanges = selectedTeam !== (currentTeamId || 'pair');
  const selectedTeamData = TEAMS_CONFIG.teams[selectedTeam];

  const handleSave = useCallback(async () => {
    if (!hasChanges || !selectedTeamData) return;

    setIsSaving(true);
    setSaveResult(null);

    try {
      await updateTeam({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        teamId: selectedTeam,
        teamName: selectedTeamData.name,
        teamRoles: selectedTeamData.roles,
        teamEntryPoint: selectedTeamData.entryPoint || selectedTeamData.roles[0],
      });
      setSaveResult('success');
      setTimeout(() => setSaveResult(null), 3000);
    } catch {
      setSaveResult('error');
    } finally {
      setIsSaving(false);
    }
  }, [hasChanges, selectedTeamData, updateTeam, chatroomId, selectedTeam]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary mb-1">
          Team Configuration
        </h3>
        <p className="text-xs text-chatroom-text-muted">
          Switch between different team configurations. Active agents will need to reconnect after
          switching.
        </p>
      </div>

      {/* Current Team Info */}
      {currentTeamRoles && currentTeamRoles.length > 0 && (
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
            Current Team
          </label>
          <div className="flex items-center gap-2 p-3 bg-chatroom-bg-tertiary border border-chatroom-border">
            <div className="flex-1">
              <div className="text-xs font-bold text-chatroom-text-primary capitalize">
                {currentTeamId || 'Unknown'}
              </div>
              <div className="text-[10px] text-chatroom-text-muted">
                Roles: {currentTeamRoles.join(', ')}
              </div>
            </div>
            <Check size={14} className="text-chatroom-status-success" />
          </div>
        </div>
      )}

      {/* Team Selector */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Select Team
        </label>
        <div className="space-y-2">
          {Object.entries(TEAMS_CONFIG.teams).map(([teamId, team]) => (
            <button
              key={teamId}
              type="button"
              onClick={() => setSelectedTeam(teamId)}
              className={`w-full text-left p-3 border transition-colors ${
                selectedTeam === teamId
                  ? 'border-chatroom-accent bg-chatroom-accent/5'
                  : 'border-chatroom-border hover:border-chatroom-border-strong hover:bg-chatroom-bg-hover'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-chatroom-text-primary">{team.name}</div>
                  <div className="text-[10px] text-chatroom-text-muted mt-0.5">
                    {team.description}
                  </div>
                </div>
                {selectedTeam === teamId && (
                  <div className="w-3 h-3 bg-chatroom-accent flex-shrink-0" />
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {team.roles.map((role) => (
                  <span
                    key={role}
                    className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 bg-chatroom-bg-tertiary text-chatroom-text-muted"
                  >
                    {role}
                  </span>
                ))}
                {team.entryPoint && (
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 bg-chatroom-status-info/10 text-chatroom-status-info">
                    entry: {team.entryPoint}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Warning */}
      {hasChanges && (
        <div className="flex items-start gap-2 p-3 bg-chatroom-status-warning/10 border border-chatroom-status-warning/30">
          <AlertTriangle size={14} className="text-chatroom-status-warning flex-shrink-0 mt-0.5" />
          <div className="text-[10px] text-chatroom-text-secondary">
            Switching teams will update the chatroom configuration. Active agents will need to
            disconnect and reconnect with the new team roles.
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            hasChanges && !isSaving
              ? 'bg-chatroom-accent text-chatroom-text-on-accent hover:bg-chatroom-accent/90'
              : 'bg-chatroom-bg-tertiary text-chatroom-text-muted cursor-not-allowed'
          }`}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
        {saveResult === 'success' && (
          <span className="text-[10px] font-bold text-chatroom-status-success flex items-center gap-1">
            <Check size={12} /> Saved
          </span>
        )}
        {saveResult === 'error' && (
          <span className="text-[10px] font-bold text-chatroom-status-error">Failed to save</span>
        )}
      </div>
    </div>
  );
});

// ─── Ping State Management ──────────────────────────────────────────────

type PingState = 'idle' | 'pinging' | 'success' | 'failed';

interface PingInfo {
  state: PingState;
  commandId: Id<'chatroom_machineCommands'> | null;
  startedAt: number | null;
}

/**
 * Hook to manage ping state for a single machine.
 * Sends a ping command and reactively watches its status.
 */
function useMachinePing(machineId: string) {
  const [pingInfo, setPingInfo] = useState<PingInfo>({
    state: 'idle',
    commandId: null,
    startedAt: null,
  });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendCommand = useSessionMutation(api.machines.sendCommand);

  // Reactively watch the command status when we have a commandId
  const commandStatus = useSessionQuery(
    api.machines.getCommandStatus,
    pingInfo.commandId ? { commandId: pingInfo.commandId } : 'skip'
  ) as
    | { status: string; result?: string; type: string; createdAt: number; processedAt?: number }
    | null
    | undefined;

  // React to command status changes
  useEffect(() => {
    if (!commandStatus || pingInfo.state !== 'pinging') return;

    if (commandStatus.status === 'completed' && commandStatus.result === 'pong') {
      setPingInfo((prev) => ({ ...prev, state: 'success' }));
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    } else if (commandStatus.status === 'failed') {
      setPingInfo((prev) => ({ ...prev, state: 'failed' }));
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, [commandStatus, pingInfo.state]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const sendPing = useCallback(async () => {
    // Reset any previous state
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setPingInfo({ state: 'pinging', commandId: null, startedAt: Date.now() });

    try {
      const result = await sendCommand({
        machineId,
        type: 'ping',
      });
      const commandId = result?.commandId as Id<'chatroom_machineCommands'> | undefined;

      if (commandId) {
        setPingInfo({ state: 'pinging', commandId, startedAt: Date.now() });

        // Auto-timeout after 10 seconds
        timeoutRef.current = setTimeout(() => {
          setPingInfo((prev) => {
            if (prev.state === 'pinging') {
              return { ...prev, state: 'failed' };
            }
            return prev;
          });
        }, 10000);
      } else {
        setPingInfo({ state: 'failed', commandId: null, startedAt: null });
      }
    } catch {
      setPingInfo({ state: 'failed', commandId: null, startedAt: null });
    }
  }, [machineId, sendCommand]);

  return { pingState: pingInfo.state, sendPing };
}

/**
 * Individual machine row with integrated ping button
 */
const MachineRow = memo(function MachineRow({
  machine,
}: {
  machine: {
    machineId: string;
    hostname: string;
    os: string;
    daemonConnected: boolean;
    lastSeenAt: number;
    registeredAt: number;
  };
}) {
  const { pingState, sendPing } = useMachinePing(machine.machineId);

  const pingLabel = (() => {
    switch (pingState) {
      case 'pinging':
        return 'Pinging...';
      case 'success':
        return 'Online';
      case 'failed':
        return 'No Response';
      default:
        return 'Ping';
    }
  })();

  const pingClasses = (() => {
    switch (pingState) {
      case 'pinging':
        return 'text-chatroom-text-muted border-chatroom-border cursor-wait';
      case 'success':
        return 'text-chatroom-status-success border-chatroom-status-success/30 bg-chatroom-status-success/10';
      case 'failed':
        return 'text-chatroom-status-error border-chatroom-status-error/30 bg-chatroom-status-error/10';
      default:
        return 'text-chatroom-text-muted border-chatroom-border hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover';
    }
  })();

  return (
    <div className="flex items-center gap-3 p-3 border border-chatroom-border bg-chatroom-bg-surface">
      <div
        className={`w-2.5 h-2.5 flex-shrink-0 ${
          pingState === 'success'
            ? 'bg-chatroom-status-success'
            : pingState === 'failed'
              ? 'bg-chatroom-status-error'
              : machine.daemonConnected
                ? 'bg-chatroom-status-success'
                : 'bg-chatroom-text-muted'
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-chatroom-text-primary truncate">
          {machine.hostname}
        </div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
          {machine.daemonConnected ? 'online' : 'offline'} · {machine.os}
        </div>
      </div>
      {machine.lastSeenAt && (
        <div className="text-[10px] text-chatroom-text-muted flex-shrink-0">
          {new Date(machine.lastSeenAt).toLocaleTimeString()}
        </div>
      )}
      <button
        onClick={sendPing}
        disabled={pingState === 'pinging'}
        className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide border transition-colors flex-shrink-0 ${pingClasses}`}
      >
        {pingState === 'pinging' && (
          <span className="inline-block w-3 h-3 border border-current border-t-transparent animate-spin mr-1.5 align-middle" />
        )}
        {pingLabel}
      </button>
    </div>
  );
});

/**
 * Machine tab — shows connected machines with ping/health-check and daemon start command
 */
const MachineContent = memo(function MachineContent(_props: { chatroomId: string }) {
  const machinesResult = useSessionQuery(api.machines.listMachines, {}) as
    | {
        machines: {
          machineId: string;
          hostname: string;
          os: string;
          daemonConnected: boolean;
          lastSeenAt: number;
          registeredAt: number;
        }[];
      }
    | undefined;
  const machines = machinesResult?.machines;

  // Daemon start command
  const { isProductionUrl } = usePrompts();
  const daemonStartCommand = useMemo(() => {
    if (isProductionUrl) {
      return 'chatroom machine daemon start';
    }
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    return `CHATROOM_CONVEX_URL=${convexUrl} chatroom machine daemon start`;
  }, [isProductionUrl]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary mb-1">
          Machine Integration
        </h3>
        <p className="text-xs text-chatroom-text-muted">
          View connected machines and their status. Use the ping button to verify if a daemon is
          responsive.
        </p>
      </div>

      {/* Connected Machines */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Connected Machines
        </label>
        {machines === undefined ? (
          <div className="p-4 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
          </div>
        ) : machines.length === 0 ? (
          <div className="p-4 text-center text-chatroom-text-muted text-xs border border-chatroom-border bg-chatroom-bg-tertiary">
            No machines connected
          </div>
        ) : (
          <div className="space-y-1">
            {machines.map((machine) => (
              <MachineRow key={machine.machineId} machine={machine} />
            ))}
          </div>
        )}
      </div>

      {/* Daemon Start Command — always visible */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Daemon Command
        </label>
        <p className="text-[10px] text-chatroom-text-muted">
          Run this command on any machine to start or restart the daemon.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-[10px] font-mono text-chatroom-status-success bg-chatroom-bg-tertiary px-2 py-1.5 border border-chatroom-border break-all">
            {daemonStartCommand}
          </code>
          <CopyButton
            text={daemonStartCommand}
            label="Copy"
            copiedLabel="Copied!"
            variant="compact"
          />
        </div>
      </div>

      {/* Future Feature Note */}
      <div className="p-3 bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] text-chatroom-text-muted">
        <strong className="text-chatroom-text-secondary">Coming soon:</strong> Automatic agent
        startup — machines will automatically start offline agents when new messages are received in
        this chatroom.
      </div>
    </div>
  );
});

// ─── Main Modal Component ───────────────────────────────────────────────

export const AgentSettingsModal = memo(function AgentSettingsModal({
  isOpen,
  onClose,
  chatroomId,
  currentTeamId,
  currentTeamRoles,
}: AgentSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('setup');

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-5xl">
      {/* Side Navigation */}
      <FixedModalSidebar className="w-48">
        {/* Sidebar Title — uses FixedModalHeader for consistent height alignment */}
        <FixedModalHeader>
          <FixedModalTitle>Settings</FixedModalTitle>
        </FixedModalHeader>

        {/* Navigation Items */}
        <nav className="flex-1 py-1">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                activeTab === tab.id
                  ? 'bg-chatroom-accent/10 text-chatroom-accent border-r-2 border-chatroom-accent'
                  : 'text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover'
              }`}
            >
              <span className="flex-shrink-0">{tab.icon}</span>
              <span className="text-xs font-bold uppercase tracking-wide">{tab.label}</span>
            </button>
          ))}
        </nav>
      </FixedModalSidebar>

      {/* Content Area */}
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle>{TAB_CONFIG.find((t) => t.id === activeTab)?.label}</FixedModalTitle>
        </FixedModalHeader>

        <FixedModalBody className="p-6">
          {activeTab === 'setup' && <SetupContent chatroomId={chatroomId} />}
          {activeTab === 'team' && (
            <TeamConfigContent
              chatroomId={chatroomId}
              currentTeamId={currentTeamId}
              currentTeamRoles={currentTeamRoles}
            />
          )}
          {activeTab === 'machine' && <MachineContent chatroomId={chatroomId} />}
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
