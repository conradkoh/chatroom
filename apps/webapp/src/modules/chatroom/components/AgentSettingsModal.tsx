'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  Settings,
  Users,
  Server,
  Monitor,
  Check,
  AlertTriangle,
  Plug,
  HardDrive,
  Trash2,
  Database,
  FileText,
  Paperclip,
  ChevronDown,
} from 'lucide-react';
import Link from 'next/link';
import React, { useState, useCallback, memo, useEffect, useMemo } from 'react';

import { useDaemonConnected } from '../../../hooks/useDaemonConnected';
import { ApplyTopFavoriteModelsButton } from '../features/machine-config/components/ApplyTopFavoriteModelsButton';
import { MachineAliasField } from '../features/machines/components/MachineAliasField';
import { useAgentPanelData } from '../hooks/useAgentPanelData';
import { WorkspaceInlineAgentListPanel } from './AgentPanel/WorkspaceInlineAgentListPanel';
import { useWorkspaceAgentDirectory } from '../hooks/useWorkspaceAgentQueries';
import type { SettingsTab } from './CommandPalette/types';
import { CopyButton } from './CopyButton';
import { IntegrationsTab } from './IntegrationsTab';
import { LifecycleConfirmDialog } from './LifecycleConfirmDialog';
import { ResponsivePickerShell, PickerScrollBody, PickerOptionRow } from './picker';
import { SkillsTab } from './SkillsTab';
import { useChatroomWorkspace } from '../context/ChatroomWorkspaceContext';
import { useTeamConfigs } from '../hooks/use-team-configs';
import { getWorkspaceDisplayHostname } from '../types/workspace';
import { useClearWorkspaceFileTree } from '../workspace/hooks/useClearWorkspaceFileTree';

import { Button } from '@/components/ui/button';
import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
  FixedModalSidebar,
} from '@/components/ui/fixed-modal';
import { Switch } from '@/components/ui/switch';
import { getDaemonStartCommand } from '@/lib/environment';
import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';
import { FileStoragePanel } from '@/modules/chatroom/features/file-attachments/components/FileStoragePanel';

// ─── Types ──────────────────────────────────────────────────────────────

interface AgentSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  currentTeamId: string | null;
  currentTeamRoles: string[];
  initialTab?: SettingsTab;
}

export type { SettingsTab };

// ─── Constants ──────────────────────────────────────────────────────────

const TAB_CONFIG: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'setup', label: 'Setup', icon: <Settings size={16} /> },
  { id: 'team', label: 'Team', icon: <Users size={16} /> },
  { id: 'machine', label: 'Machine', icon: <Server size={16} /> },
  { id: 'agents', label: 'Agents', icon: <Monitor size={16} /> },
  { id: 'workspaces', label: 'Workspaces', icon: <HardDrive size={16} /> },
  { id: 'skills', label: 'Skills', icon: <FileText size={16} /> },
  { id: 'integrations', label: 'Integrations', icon: <Plug size={16} /> },
  { id: 'files', label: 'Files', icon: <Paperclip size={16} /> },
];

// ─── Tab Content Components ─────────────────────────────────────────────

/**
 * Setup tab — shows the chatroom ID and basic setup information
 */
const SetupContent = memo(function SetupContent({
  chatroomId,
  onArchiveComplete,
}: {
  chatroomId: string;
  onArchiveComplete?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(chatroomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [chatroomId]);

  const handleArchive = useCallback(() => {
    setArchiveDialogOpen(true);
  }, []);

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
        <Button
          variant="destructive"
          size="sm"
          className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider"
          onClick={handleArchive}
        >
          Archive Chat
        </Button>
      </div>

      <LifecycleConfirmDialog
        open={archiveDialogOpen}
        onOpenChange={setArchiveDialogOpen}
        chatroomId={chatroomId as Id<'chatroom_rooms'>}
        action="archive"
        onConfirmed={onArchiveComplete}
      />
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
  currentTeamId: string | null;
  currentTeamRoles: string[];
}) {
  const { teams, defaultTeamId, getById } = useTeamConfigs();
  const currentTeamSelection = currentTeamId ?? defaultTeamId;
  const [selectedTeam, setSelectedTeam] = useState<string>(currentTeamSelection);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null);

  useEffect(() => {
    setSelectedTeam(currentTeamSelection);
  }, [currentTeamSelection]);

  const updateTeam = useSessionMutation(api.chatrooms.updateTeam);

  const hasChanges = selectedTeam !== currentTeamSelection;
  const selectedTeamData = getById(selectedTeam);

  const handleSave = useCallback(async () => {
    if (!hasChanges || !selectedTeamData) return;

    setIsSaving(true);
    setSaveResult(null);

    try {
      await updateTeam({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        teamStructureId: selectedTeam,
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
      {currentTeamRoles.length > 0 && (
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
            Current Team
          </label>
          <div className="flex items-center gap-2 p-3 bg-chatroom-bg-tertiary border border-chatroom-border">
            <div className="flex-1">
              <div className="text-xs font-bold text-chatroom-text-primary uppercase tracking-widest">
                {currentTeamId ?? 'Unknown'}
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
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setSelectedTeam(team.id)}
              className={`w-full text-left p-3 border transition-colors ${
                selectedTeam === team.id
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
                {selectedTeam === team.id && (
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
 * Individual machine row. Alias editing is delegated to the shared
 * MachineAliasField so the settings modal and Machines page stay in lockstep.
 */
const MachineRow = memo(function MachineRow({
  machine,
}: {
  machine: {
    machineId: string;
    hostname: string;
    alias?: string;
    os: string;
    registeredAt: number;
  };
}) {
  const { isConnected: daemonConnected } = useDaemonConnected(machine.machineId);

  return (
    <div className="flex items-center gap-3 p-3 border border-chatroom-border bg-chatroom-bg-surface">
      <div
        className={`w-2.5 h-2.5 flex-shrink-0 ${daemonConnected ? 'bg-chatroom-status-success' : 'bg-chatroom-text-muted'}`}
      />
      <div className="flex-1 min-w-0">
        <MachineAliasField
          machineId={machine.machineId}
          alias={machine.alias}
          hostname={machine.hostname}
          compact
        />
        <div className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
          {machine.alias ? `${machine.hostname} · ` : ''}
          {daemonConnected ? 'online' : 'offline'} · {machine.os}
        </div>
      </div>
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
            <ChatroomLoader size="lg" />
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
 * Workspaces tab — lists all registered workspaces, selects the active workspace, and allows deletion.
 * Deletion is disabled for workspaces that have active remote agents.
 */
const WorkspacesContent = memo(function WorkspacesContent() {
  const { machineConfigs } = useAgentPanelData();
  const {
    workspaces: registeredWorkspaces,
    activeWorkspace,
    isLoading,
    removeWorkspace,
    setPrimaryWorkspace,
  } = useChatroomWorkspace();
  const workspaces = useMemo(
    () =>
      registeredWorkspaces.map((workspace) => ({
        ...workspace,
        agentRoles: machineConfigs
          .filter((config) => config.workingDir === workspace.workingDir)
          .map((config) => config.role),
      })),
    [machineConfigs, registeredWorkspaces]
  );
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null);
  const purgeFileTreeMutation = useSessionMutation(api.workspaceFiles.purgeFileTreeV2);
  const purgeFileContentMutation = useSessionMutation(api.workspaceFiles.purgeFileContentV2);
  const purgeFullDiffMutation = useSessionMutation(api.workspaces.purgeFullDiffV2);
  const purgeCommitDetailMutation = useSessionMutation(api.workspaces.purgeCommitDetailV2);
  const requestFileTreeMutation = useSessionMutation(api.workspaceFiles.requestFileTree);
  const setFileTreeSyncEnabledMutation = useSessionMutation(api.workspaces.setFileTreeSyncEnabled);
  const [fileTreeSyncPendingIds, setFileTreeSyncPendingIds] = useState<Set<string>>(new Set());
  const [fileTreeSyncErrors, setFileTreeSyncErrors] = useState<Record<string, string>>({});

  // Build a set of machineId::workingDir keys for active team agents.
  // Any agent in the active team that has a machine + workspace configured
  // protects that workspace from deletion.
  const activeAgentWorkspaceKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const config of machineConfigs) {
      if (config.machineId && config.workingDir) {
        keys.add(`${config.machineId}::${config.workingDir}`);
      }
    }
    return keys;
  }, [machineConfigs]);

  const [removeError, setRemoveError] = useState<string | null>(null);
  const [primaryError, setPrimaryError] = useState<string | null>(null);

  const handleRemove = useCallback(
    async (registryId: string) => {
      setRemovingId(registryId);
      setRemoveError(null);
      try {
        await removeWorkspace(registryId);
      } catch (err) {
        setRemoveError(err instanceof Error ? err.message : 'Failed to remove workspace');
      } finally {
        setRemovingId(null);
      }
    },
    [removeWorkspace]
  );

  const handleSetPrimary = useCallback(
    async (registryId: string) => {
      setSettingPrimaryId(registryId);
      setPrimaryError(null);
      try {
        await setPrimaryWorkspace(registryId);
      } catch (err) {
        setPrimaryError(err instanceof Error ? err.message : 'Failed to set active workspace');
      } finally {
        setSettingPrimaryId(null);
      }
    },
    [setPrimaryWorkspace]
  );

  // Toggle file-tree sync for a single workspace (per registry id). No optimistic
  // update — the Convex subscription is the source of truth for the switch state.
  const handleFileTreeSyncToggle = useCallback(
    async (registryId: string, enabled: boolean) => {
      if (fileTreeSyncPendingIds.has(registryId)) return;
      // A new attempt on this workspace clears its previous failure.
      setFileTreeSyncErrors((prev) => {
        if (!(registryId in prev)) return prev;
        const next = { ...prev };
        delete next[registryId];
        return next;
      });
      setFileTreeSyncPendingIds((prev) => new Set(prev).add(registryId));
      try {
        await setFileTreeSyncEnabledMutation({
          workspaceId: registryId as Id<'chatroom_workspaces'>,
          enabled,
        });
      } catch {
        const message = enabled
          ? 'Failed to enable workspace file tree sync'
          : 'Failed to disable workspace file tree sync';
        setFileTreeSyncErrors((prev) => ({ ...prev, [registryId]: message }));
      } finally {
        setFileTreeSyncPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(registryId);
          return next;
        });
      }
    },
    [fileTreeSyncPendingIds, setFileTreeSyncEnabledMutation]
  );

  // Purge cache dialog state
  const [purgeDialogWs, setPurgeDialogWs] = useState<{
    machineId: string;
    workingDir: string;
    id: string;
  } | null>(null);
  const [purgingCategory, setPurgingCategory] = useState<string | null>(null);
  const [purgedCategories, setPurgedCategories] = useState<Set<string>>(new Set());

  const clearWorkspaceFileTreeCache = useClearWorkspaceFileTree();

  const handlePurgeCategory = useCallback(
    async (
      category: string,
      mutationFn: (args: { machineId: string; workingDir: string }) => Promise<unknown>
    ) => {
      if (!purgeDialogWs) return;
      setPurgingCategory(category);
      try {
        const { machineId, workingDir } = purgeDialogWs;
        const normalizedWorkingDir = normalizeWorkspaceWorkingDir(workingDir);

        if (category === 'fileTree') {
          let complete = false;
          while (!complete) {
            const result = (await mutationFn({
              machineId,
              workingDir: normalizedWorkingDir,
            })) as { complete: boolean };
            complete = result.complete;
          }

          clearWorkspaceFileTreeCache(machineId, normalizedWorkingDir);
          await requestFileTreeMutation({
            machineId,
            workingDir: normalizedWorkingDir,
            force: true,
          }).catch(() => {});
        } else {
          await mutationFn({
            machineId,
            workingDir: normalizedWorkingDir,
          });
        }

        setPurgedCategories((prev) => new Set(prev).add(category));
      } catch (err) {
        console.warn('Purge failed:', err instanceof Error ? err.message : err);
      } finally {
        setPurgingCategory(null);
      }
    },
    [purgeDialogWs, requestFileTreeMutation, clearWorkspaceFileTreeCache]
  );

  if (isLoading) {
    return <div className="p-4 text-sm text-chatroom-text-muted">Loading workspaces…</div>;
  }

  if (workspaces.length === 0) {
    return (
      <div className="p-4 text-sm text-chatroom-text-muted">
        No workspaces registered. Workspaces are automatically registered when a machine daemon
        connects.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-1">
      <p className="text-xs text-chatroom-text-muted px-2">
        Choose an active workspace for the file explorer, commands, git panels, and workspace-scoped
        agent views. Remove a workspace to disassociate it from this chatroom.
      </p>
      {removeError && (
        <div className="text-xs text-red-600 dark:text-red-400 px-2 py-1 bg-red-50 dark:bg-red-950/20 rounded">
          {removeError}
        </div>
      )}
      {primaryError && (
        <div className="text-xs text-red-600 dark:text-red-400 px-2 py-1 bg-red-50 dark:bg-red-950/20 rounded">
          {primaryError}
        </div>
      )}
      {workspaces.map((ws) => {
        const hostname = getWorkspaceDisplayHostname(ws);
        const registryId = ws._registryId;
        const hasActiveRemote = ws.machineId
          ? activeAgentWorkspaceKeys.has(`${ws.machineId}::${ws.workingDir}`)
          : false;
        const isRemoving = removingId === ws._registryId;
        const canRemove = !hasActiveRemote && !isRemoving && !!registryId;
        const isActive = Boolean(registryId && activeWorkspace?._registryId === registryId);
        const isSettingPrimary = settingPrimaryId === registryId;

        return (
          <div
            key={ws.id}
            className="flex items-start gap-3 px-3 py-2.5 rounded border border-chatroom-border bg-chatroom-bg-secondary/30"
          >
            <HardDrive size={16} className="shrink-0 mt-0.5 text-chatroom-text-muted" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-chatroom-text-primary truncate">
                {hostname}
              </div>
              <div className="text-xs text-chatroom-text-muted font-mono truncate mt-0.5">
                {ws.workingDir}
              </div>
              {registryId ? (
                <div
                  data-testid={`file-tree-sync-row-${registryId}`}
                  className="mt-3 flex items-center justify-between gap-4 border-t border-chatroom-border pt-3"
                >
                  <div className="min-w-0">
                    <label
                      htmlFor={`file-tree-sync-${registryId}`}
                      className="text-xs font-medium text-chatroom-text-primary"
                    >
                      Sync file tree
                    </label>
                    <p className="text-[10px] text-chatroom-text-muted">
                      Allow this workspace&apos;s file and folder changes to sync to Chatroom.
                    </p>
                    {fileTreeSyncErrors[registryId] ? (
                      <p role="alert" className="mt-1 text-xs text-chatroom-status-error">
                        {fileTreeSyncErrors[registryId]}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {fileTreeSyncPendingIds.has(registryId) ? (
                      <span className="text-[10px] text-chatroom-text-muted">
                        {ws.fileTreeSyncEnabled ? 'Disabling…' : 'Enabling…'}
                      </span>
                    ) : null}
                    <Switch
                      id={`file-tree-sync-${registryId}`}
                      checked={ws.fileTreeSyncEnabled}
                      disabled={fileTreeSyncPendingIds.has(registryId)}
                      onCheckedChange={(checked) => handleFileTreeSyncToggle(registryId, checked)}
                      aria-label={`Sync file tree for ${hostname}`}
                    />
                  </div>
                </div>
              ) : null}
              {ws.agentRoles.length > 0 && (
                <div className="text-[10px] text-chatroom-text-muted mt-1">
                  Agents: {ws.agentRoles.join(', ')}
                </div>
              )}
              {hasActiveRemote && (
                <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                  <AlertTriangle size={10} />
                  Active team agents use this workspace
                </div>
              )}
              {registryId && (
                <div className="mt-2 flex items-center gap-2">
                  {isActive ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-chatroom-status-success">
                      <Check size={11} aria-hidden="true" />
                      Active workspace
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleSetPrimary(registryId)}
                      disabled={isSettingPrimary}
                      className="text-[10px] font-bold uppercase tracking-wide text-chatroom-accent hover:text-chatroom-text-primary transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                      {isSettingPrimary ? 'Setting active…' : 'Set as active'}
                    </button>
                  )}
                </div>
              )}
              {/* Data purge controls */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    ws.machineId &&
                    setPurgeDialogWs({
                      machineId: ws.machineId,
                      workingDir: ws.workingDir,
                      id: ws.id,
                    })
                  }
                  className="text-[10px] px-2 py-0.5 rounded border border-chatroom-border text-chatroom-text-muted hover:text-red-500 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-800 transition-colors flex items-center gap-1"
                >
                  <Database size={10} />
                  Purge Cache
                </button>
              </div>
            </div>
            <button
              type="button"
              disabled={!canRemove}
              onClick={() => ws._registryId && handleRemove(ws._registryId)}
              className="shrink-0 p-1.5 rounded text-chatroom-text-muted hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-chatroom-text-muted disabled:hover:bg-transparent"
              title={hasActiveRemote ? 'Cannot remove: active remote agents' : 'Remove workspace'}
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}

      {/* Purge Cache Dialog */}
      <Dialog
        open={!!purgeDialogWs}
        onOpenChange={(open) => {
          if (!open) {
            setPurgeDialogWs(null);
            setPurgedCategories(new Set());
            setPurgingCategory(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Purge Cache</DialogTitle>
            <DialogDescription>
              Clear cached data for this workspace. Data will be re-fetched automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {[
              {
                key: 'fileTree',
                label: 'File Tree',
                desc: 'Cached file tree data',
                fn: purgeFileTreeMutation,
              },
              {
                key: 'fileContent',
                label: 'File Content',
                desc: 'Cached file contents',
                fn: purgeFileContentMutation,
              },
              {
                key: 'fullDiff',
                label: 'Git Diffs',
                desc: 'Cached git diff output',
                fn: purgeFullDiffMutation,
              },
              {
                key: 'commitDetail',
                label: 'Commit Details',
                desc: 'Cached commit detail data',
                fn: purgeCommitDetailMutation,
              },
            ].map(({ key, label, desc, fn }) => (
              <div
                key={key}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded border border-border bg-card/50"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
                <button
                  type="button"
                  disabled={purgingCategory === key || purgedCategories.has(key)}
                  onClick={() => handlePurgeCategory(key, fn)}
                  className="shrink-0 text-xs px-3 py-1 rounded border border-border text-muted-foreground hover:text-red-500 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[80px] text-center"
                >
                  {purgingCategory === key
                    ? 'Purging...'
                    : purgedCategories.has(key)
                      ? 'Purged \u2713'
                      : 'Purge'}
                </button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
});

/** Agents tab — shows every role in the current team scoped to the active workspace. */
const AgentsContent = memo(function AgentsContent({ chatroomId }: { chatroomId: string }) {
  const { agents, isLoading } = useWorkspaceAgentDirectory();
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary mb-1">
            Agents
          </h3>
          <p className="text-xs text-chatroom-text-muted">
            This is the single configuration surface for all permanent and ephemeral agents.
            Ephemeral agents start on demand.{' '}
            {isLoading
              ? 'Loading agents...'
              : `${agents.length} agents available for this workspace.`}
          </p>
        </div>
        <ApplyTopFavoriteModelsButton variant="labelled" />
      </div>
      <WorkspaceInlineAgentListPanel
        chatroomId={chatroomId}
        variant="bordered"
        emptyClassName="p-4 text-center text-chatroom-text-muted text-xs border border-chatroom-border bg-chatroom-bg-tertiary"
      />
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
  const [mobileTabPickerOpen, setMobileTabPickerOpen] = useState(false);

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
          <ResponsivePickerShell
            open={mobileTabPickerOpen}
            onOpenChange={setMobileTabPickerOpen}
            title="Select tab"
            align="start"
            contentClassName="w-72"
            trigger={
              <button
                type="button"
                data-testid="settings-mobile-tab-trigger"
                className="flex h-9 w-full items-center gap-2 rounded-none border border-chatroom-border bg-chatroom-bg-surface px-3 text-xs font-bold uppercase tracking-wide text-chatroom-text-primary hover:bg-chatroom-bg-hover focus:outline-none focus:ring-0"
              >
                <span className="shrink-0 text-chatroom-text-muted">
                  {TAB_CONFIG.find((t) => t.id === activeTab)?.icon}
                </span>
                <span className="min-w-0 flex-1 truncate text-left">
                  {TAB_CONFIG.find((t) => t.id === activeTab)?.label ?? 'Select tab'}
                </span>
                <ChevronDown size={14} className="shrink-0 text-chatroom-text-muted" />
              </button>
            }
          >
            <PickerScrollBody maxHeightClassName="max-h-60">
              {TAB_CONFIG.map((tab) => (
                <PickerOptionRow
                  key={tab.id}
                  selected={activeTab === tab.id}
                  onSelect={() => {
                    setActiveTab(tab.id);
                    setMobileTabPickerOpen(false);
                  }}
                >
                  {tab.label}
                </PickerOptionRow>
              ))}
            </PickerScrollBody>
          </ResponsivePickerShell>
        </div>

        <FixedModalBody className="p-4 sm:p-6">
          {activeTab === 'setup' && (
            <SetupContent chatroomId={chatroomId} onArchiveComplete={onClose} />
          )}
          {activeTab === 'team' && (
            <TeamConfigContent
              chatroomId={chatroomId}
              currentTeamId={currentTeamId}
              currentTeamRoles={currentTeamRoles}
            />
          )}
          {activeTab === 'machine' && <MachineContent chatroomId={chatroomId} />}
          {activeTab === 'agents' && <AgentsContent chatroomId={chatroomId} />}
          {activeTab === 'workspaces' && <WorkspacesContent />}
          {activeTab === 'skills' && <SkillsTab chatroomId={chatroomId} />}
          {activeTab === 'integrations' && <IntegrationsTab chatroomId={chatroomId} />}
          {activeTab === 'files' && (
            <div className="space-y-6">
              <p className="text-xs text-chatroom-text-muted">
                Files agents attached to handoffs in this chatroom. This chatroom&apos;s limit
                can&apos;t exceed your account limit.{' '}
                <Link
                  href="/app/profile"
                  className="text-chatroom-accent underline-offset-4 hover:underline"
                >
                  Manage account storage →
                </Link>
              </p>
              <FileStoragePanel
                scope={{ kind: 'chatroom', chatroomId: chatroomId as Id<'chatroom_rooms'> }}
              />
            </div>
          )}
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
