'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Settings, Users, Server, X, Check, AlertTriangle } from 'lucide-react';
import React, { useState, useCallback, memo, useEffect } from 'react';
import { createPortal } from 'react-dom';

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;
  const updateTeam = useSessionMutation(chatroomApi.chatrooms.updateTeam);

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

/**
 * Machine tab — placeholder for future machine integration
 */
const MachineContent = memo(function MachineContent(_props: { chatroomId: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;
  const machines = useSessionQuery(chatroomApi.machines.listMachines, {}) as
    | { _id: string; name: string; status: string; lastHeartbeat?: number }[]
    | undefined;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary mb-1">
          Machine Integration
        </h3>
        <p className="text-xs text-chatroom-text-muted">
          View connected machines and their status. Future updates will allow automatic agent
          startup when messages are received.
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
              <div
                key={machine._id}
                className="flex items-center gap-3 p-3 border border-chatroom-border bg-chatroom-bg-surface"
              >
                <div
                  className={`w-2.5 h-2.5 flex-shrink-0 ${
                    machine.status === 'online'
                      ? 'bg-chatroom-status-success'
                      : 'bg-chatroom-text-muted'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-chatroom-text-primary truncate">
                    {machine.name}
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
                    {machine.status}
                  </div>
                </div>
                {machine.lastHeartbeat && (
                  <div className="text-[10px] text-chatroom-text-muted">
                    {new Date(machine.lastHeartbeat).toLocaleTimeString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
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

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className="chatroom-root w-full max-w-3xl max-h-[85vh] flex bg-chatroom-bg-primary border-2 border-chatroom-border-strong overflow-hidden">
        {/* Side Navigation */}
        <div className="w-48 flex-shrink-0 bg-chatroom-bg-surface border-r-2 border-chatroom-border-strong flex flex-col">
          {/* Modal Title */}
          <div className="px-4 py-3 border-b-2 border-chatroom-border-strong">
            <h2 className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary">
              Settings
            </h2>
          </div>

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
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header with close button */}
          <div className="flex items-center justify-between px-6 py-3 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface">
            <div className="text-xs font-bold uppercase tracking-wider text-chatroom-text-muted">
              {TAB_CONFIG.find((t) => t.id === activeTab)?.label}
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'setup' && <SetupContent chatroomId={chatroomId} />}
            {activeTab === 'team' && (
              <TeamConfigContent
                chatroomId={chatroomId}
                currentTeamId={currentTeamId}
                currentTeamRoles={currentTeamRoles}
              />
            )}
            {activeTab === 'machine' && <MachineContent chatroomId={chatroomId} />}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
});
