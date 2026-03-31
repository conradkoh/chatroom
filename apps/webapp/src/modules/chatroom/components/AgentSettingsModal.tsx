'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Settings, Users, Server, Monitor, Check, AlertTriangle, Pencil, X, Plug } from 'lucide-react';
import React, { useState, useCallback, useContext, memo, useEffect, useRef, useMemo } from 'react';

import { CopyButton } from './CopyButton';

import { useAgentPanelData } from '../hooks/useAgentPanelData';
import { useAgentStatuses } from '../hooks/useAgentStatuses';
import { InlineAgentCard } from './AgentPanel/InlineAgentCard';
import { PromptsContext } from '@/contexts/PromptsContext';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
  FixedModalSidebar,
} from '@/components/ui/fixed-modal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getDaemonStartCommand } from '@/lib/environment';
import { IntegrationsTab } from './IntegrationsTab';
import { TEAMS_CONFIG } from '../config/teams';

// ─── Types ──────────────────────────────────────────────────────────────

interface AgentSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  currentTeamId?: string;
  currentTeamRoles?: string[];
  initialTab?: SettingsTab;
}

export type SettingsTab = 'setup' | 'team' | 'machine' | 'agents' | 'integrations';

// ─── Constants ──────────────────────────────────────────────────────────

const TAB_CONFIG: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'setup', label: 'Setup', icon: <Settings size={16} /> },
  { id: 'team', label: 'Team', icon: <Users size={16} /> },
  { id: 'machine', label: 'Machine', icon: <Server size={16} /> },
  { id: 'agents', label: 'Agents', icon: <Monitor size={16} /> },
  { id: 'integrations', label: 'Integrations', icon: <Plug size={16} /> },
];

// ─── Tab Content Components ─────────────────────────────────────────────

/**
 * Setup tab — shows the chatroom ID and basic setup information
 */
const SetupContent = memo(function SetupContent({ chatroomId }: { chatroomId: string }) {
  const [copied, setCopied] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const updateStatus = useSessionMutation(api.chatrooms.updateStatus);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(chatroomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [chatroomId]);

  const handleArchive = useCallback(async () => {
    setIsArchiving(true);
    try {
      await updateStatus({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        status: 'completed',
      });
    } catch (error) {
      console.error('Failed to archive chat:', error);
    } finally {
      setIsArchiving(false);
    }
  }, [updateStatus, chatroomId]);

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

      {/* Connection Command */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Connection Command
        </label>
        <div className="font-mono text-[10px] text-chatroom-text-secondary break-all p-3 bg-chatroom-bg-tertiary border border-chatroom-border leading-relaxed">
          chatroom get-next-task --chatroom-id={chatroomId} --role=&lt;role&gt;
        </div>
      </div>

      {/* Chat Actions */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Chat Actions
        </label>
        <p className="text-[10px] text-chatroom-text-muted">
          Archive this chat to mark it as complete. Archived chats appear in the Complete tab.
        </p>
        <button
          onClick={handleArchive}
          disabled={isArchiving}
          className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/30 hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isArchiving ? 'Archiving...' : 'Archive Chat'}
        </button>
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
  const [selectedTeam, setSelectedTeam] = useState<string>(currentTeamId || 'duo');
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null);

  const updateTeam = useSessionMutation(api.chatrooms.updateTeam);

  const hasChanges = selectedTeam !== (currentTeamId || 'duo');
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
              <div className="text-xs font-bold text-chatroom-text-primary uppercase tracking-widest">
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
                  <div className="text-xs font-bold text-chatroom-text-primary uppercase tracking-widest">
                    {team.name}
                  </div>
                  <div className="text-[10px] text-chatroom-text-muted mt-0.5">
                    {team.description}
                  </div>
                </div>
                {selectedTeam === teamId && (
                  <Check size={12} className="text-chatroom-accent flex-shrink-0" />
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

/**
 * Individual machine row with inline alias editing
 */
const MachineRow = memo(function MachineRow({
  machine,
}: {
  machine: {
    machineId: string;
    hostname: string;
    alias?: string;
    os: string;
    daemonConnected: boolean;
    lastSeenAt: number;
    registeredAt: number;
  };
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [aliasValue, setAliasValue] = useState(machine.alias || '');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const setMachineAlias = useSessionMutation(api.machines.setMachineAlias);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = useCallback(() => {
    setAliasValue(machine.alias || '');
    setIsEditing(true);
  }, [machine.alias]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setAliasValue(machine.alias || '');
  }, [machine.alias]);

  const handleSaveAlias = useCallback(async () => {
    const trimmed = aliasValue.trim();
    // No change — just close
    if (trimmed === (machine.alias || '')) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    try {
      await setMachineAlias({
        machineId: machine.machineId,
        alias: trimmed || undefined, // empty string clears alias
      });
      setIsEditing(false);
    } catch {
      // Keep editing on error
    } finally {
      setIsSaving(false);
    }
  }, [aliasValue, machine.alias, machine.machineId, setMachineAlias]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSaveAlias();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancelEdit();
      }
    },
    [handleSaveAlias, handleCancelEdit]
  );

  const displayName = machine.alias || machine.hostname;

  return (
    <div className="flex items-center gap-3 p-3 border border-chatroom-border bg-chatroom-bg-surface">
      <div
        className={`w-2.5 h-2.5 flex-shrink-0 ${machine.daemonConnected ? 'bg-chatroom-status-success' : 'bg-chatroom-text-muted'}`}
      />
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={aliasValue}
              onChange={(e) => setAliasValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSaveAlias}
              maxLength={64}
              placeholder={machine.hostname}
              disabled={isSaving}
              className="flex-1 min-w-0 text-xs font-bold text-chatroom-text-primary bg-chatroom-bg-tertiary border border-chatroom-accent px-1.5 py-0.5 outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCancelEdit}
              className="flex-shrink-0 p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary"
              title="Cancel"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="group flex items-center gap-1.5">
            <div className="text-xs font-bold text-chatroom-text-primary truncate">
              {displayName}
            </div>
            <button
              type="button"
              onClick={handleStartEdit}
              className="flex-shrink-0 p-0.5 text-chatroom-text-muted opacity-0 group-hover:opacity-100 hover:text-chatroom-text-primary transition-opacity"
              title="Edit alias"
            >
              <Pencil size={10} />
            </button>
          </div>
        )}
        <div className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
          {machine.alias ? `${machine.hostname} · ` : ''}
          {machine.daemonConnected ? 'online' : 'offline'} · {machine.os}
        </div>
      </div>
      {machine.lastSeenAt && (
        <div className="text-[10px] text-chatroom-text-muted flex-shrink-0">
          {new Date(machine.lastSeenAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
});

/**
 * Machine tab — shows connected machines and daemon start command
 */
const MachineContent = memo(function MachineContent(_props: { chatroomId: string }) {
  const machinesResult = useSessionQuery(api.machines.listMachines, {});
  const machines = machinesResult?.machines;

  // Daemon start command
  const daemonStartCommand = getDaemonStartCommand();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary mb-1">
          Machine Integration
        </h3>
        <p className="text-xs text-chatroom-text-muted">
          View connected machines and their status.
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

    </div>
  );
});

// ─── Agents Content ─────────────────────────────────────────────────

/**
 * Agents tab — shows a flat list of all agents for the team.
 * Uses InlineAgentCard for each agent to show full configuration details
 * (status, controls, machine, model, restart stats).
 */
const AgentsContent = memo(function AgentsContent({
  chatroomId,
}: {
  chatroomId: string;
}) {
  const {
    agents: agentRoleViews,
    teamRoles,
    connectedMachines,
    machineConfigs: agentConfigs,
    sendCommand,
    agentPreferenceMap,
    savePreference,
    isLoading: isPanelLoading,
  } = useAgentPanelData(chatroomId);

  const { agents: agentStatusList } = useAgentStatuses(chatroomId, teamRoles);

  // Build a status lookup map
  const statusMap = useMemo(() => {
    const map = new Map<string, (typeof agentStatusList)[number]>();
    for (const agent of agentStatusList) {
      map.set(agent.role.toLowerCase(), agent);
    }
    return map;
  }, [agentStatusList]);

  // Build a role → AgentRoleView map for InlineAgentCard
  const agentRoleViewMap = useMemo(() => {
    const map = new Map<string, (typeof agentRoleViews)[number]>();
    for (const agent of agentRoleViews) {
      map.set(agent.role.toLowerCase(), agent);
    }
    return map;
  }, [agentRoleViews]);

  // Safe prompt generation — works inside and outside PromptsProvider
  const promptsContext = useContext(PromptsContext);
  const generatePrompt = useCallback(
    (role: string): string => promptsContext?.getAgentPrompt(role) ?? '',
    [promptsContext]
  );

  // Batch restart summaries for all roles
  const allRoles = useMemo(() => agentStatusList.map((a) => a.role), [agentStatusList]);
  const restartSummaries = useSessionQuery(api.machines.getAgentRestartSummariesByRoles, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    roles: allRoles,
  });
  const restartSummaryMap = useMemo(() => {
    const map = new Map<string, { count1h: number; count24h: number }>();
    if (restartSummaries) {
      for (const summary of restartSummaries) {
        map.set(summary.role.toLowerCase(), {
          count1h: summary.count1h,
          count24h: summary.count24h,
        });
      }
    }
    return map;
  }, [restartSummaries]);

  const totalAgents = agentStatusList.length;
  const onlineAgents = agentStatusList.filter((a) => a.online).length;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary mb-1">
          Agents
        </h3>
        <p className="text-xs text-chatroom-text-muted">
          {onlineAgents}/{totalAgents} agents online.
        </p>
      </div>

      {agentStatusList.length === 0 ? (
        <div className="p-4 text-center text-chatroom-text-muted text-xs border border-chatroom-border bg-chatroom-bg-tertiary">
          No agents configured
        </div>
      ) : (
        <div className="border border-chatroom-border bg-chatroom-bg-surface">
          {agentStatusList.map((agent) => {
            const status = statusMap.get(agent.role.toLowerCase());

            return (
              <InlineAgentCard
                key={agent.role}
                role={agent.role}
                allRoles={teamRoles}
                online={status?.online ?? false}
                lastSeenAt={status?.lastSeenAt}
                latestEventType={status?.latestEventType}
                statusVariant={status?.statusVariant ?? 'offline'}
                prompt={generatePrompt(agent.role)}
                chatroomId={chatroomId}
                connectedMachines={connectedMachines}
                isLoadingMachines={isPanelLoading}
                agentConfigs={agentConfigs}
                sendCommand={sendCommand}
                agentRoleView={agentRoleViewMap.get(agent.role.toLowerCase())}
                agentPreference={agentPreferenceMap.get(agent.role.toLowerCase())}
                onSavePreference={savePreference}
                restartSummary={restartSummaryMap.get(agent.role.toLowerCase())}
              />
            );
          })}
        </div>
      )}
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
  initialTab,
}: AgentSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? 'setup');

  // Sync activeTab when initialTab changes (e.g. opening to a different tab)
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-5xl">
      {/* Side Navigation — hidden on mobile */}
      <FixedModalSidebar className="w-48 hidden sm:flex">
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

        {/* Mobile tab selector — visible only on small screens */}
        <div className="sm:hidden border-b border-chatroom-border px-4 py-2 flex-shrink-0">
          <Select value={activeTab} onValueChange={(val) => setActiveTab(val as SettingsTab)}>
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAB_CONFIG.map((tab) => (
                <SelectItem key={tab.id} value={tab.id}>
                  {tab.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
          {activeTab === 'agents' && <AgentsContent chatroomId={chatroomId} />}
          {activeTab === 'integrations' && <IntegrationsTab chatroomId={chatroomId} />}
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
