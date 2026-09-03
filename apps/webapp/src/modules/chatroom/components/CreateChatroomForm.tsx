'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { parseGitHubOwnerRepo } from '@workspace/shared/domain/github-url';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Loader2, Monitor } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ResponsivePickerShell,
  PickerSearch,
  PickerScrollBody,
  PickerOptionRow,
  usePickerSearchState,
  filterPickerItems,
} from './picker';
import { useTeamConfigs } from '../hooks/use-team-configs';
import type { MachineInfo } from '../types/machine';
import { getMachineDisplayName } from '../types/machine';
import { normalizePastedChatroomName } from '../utils/normalizeChatroomName';

import { useDaemonConnectivity } from '@/hooks/useDaemonConnectivity';
import { useRepositoryClone } from '@/hooks/useRepositoryClone';

interface CreateChatroomFormProps {
  onCreated: (chatroomId: string) => void;
  onCancel: () => void;
}

interface MachineOptionProps {
  machine: MachineInfo;
  connected: boolean;
  hasRoot: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}

function MachineOption({
  machine,
  connected,
  hasRoot,
  selected,
  disabled,
  onSelect,
}: MachineOptionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`flex items-center gap-3 p-3 border text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        selected
          ? 'border-chatroom-accent bg-chatroom-bg-surface'
          : 'border-chatroom-border hover:border-chatroom-border-strong'
      }`}
    >
      <Monitor size={16} className="text-chatroom-text-muted flex-shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-chatroom-text-primary truncate">
          {getMachineDisplayName(machine)}
        </span>
        <span className="block text-[10px] text-chatroom-text-muted">
          {!connected ? 'Daemon offline' : !hasRoot ? 'Repository root not configured' : 'Ready'}
        </span>
      </span>
    </button>
  );
}

// This form owns the two supported create workflows and their UI states.
// fallow-ignore-next-line complexity
export function CreateChatroomForm({ onCreated, onCancel }: CreateChatroomFormProps) {
  const { teams, defaultTeamId, getById } = useTeamConfigs();
  const [selectedTeam, setSelectedTeam] = useState<string>(defaultTeamId);
  const [githubUrl, setGithubUrl] = useState('');
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [cloneStarted, setCloneStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const machinesResult = useSessionQuery(api.machines.listMachines, {});
  const repositoryRootsResult = useSessionQuery(api.machines.listMachineRepositoryRoots, {});
  const machines = useMemo(
    () => (machinesResult?.machines ?? []) as MachineInfo[],
    [machinesResult?.machines]
  );
  const daemonConnectivity = useDaemonConnectivity(machines.map((machine) => machine.machineId));
  const repositoryRoots = repositoryRootsResult ?? {};
  const selectedMachine = machines.find((machine) => machine.machineId === selectedMachineId);
  const selectedMachineConnected =
    selectedMachineId !== null && daemonConnectivity.get(selectedMachineId)?.connected === true;
  const selectedMachineHasRoot =
    selectedMachineId !== null && Boolean(repositoryRoots[selectedMachineId]);

  const createChatroom = useSessionMutation(api.chatrooms.create);
  const registerWorkspace = useSessionMutation(api.workspaces.registerWorkspace);
  const renameChatroom = useSessionMutation(api.chatrooms.rename);
  const { requestClone, request, reset: resetClone, isPending, isTimedOut } = useRepositoryClone();

  const createTeamChatroom = useCallback(async () => {
    const team = getById(selectedTeam);
    if (!team) throw new Error('Select a team configuration');
    return createChatroom({
      teamId: selectedTeam,
      teamName: team.name,
      teamRoles: team.roles,
      teamEntryPoint: team.entryPoint || team.roles[0],
    });
  }, [createChatroom, getById, selectedTeam]);

  // Post-clone creation intentionally sequences three mutations.
  // fallow-ignore-next-line complexity
  const createFromRepository = useCallback(
    async (workingDir: string) => {
      if (!selectedMachine || !selectedMachineId) throw new Error('Select a machine');
      const chatroomId = await createTeamChatroom();
      await registerWorkspace({
        chatroomId,
        machineId: selectedMachineId,
        workingDir,
        hostname: selectedMachine.hostname,
        registeredBy: 'user',
      });
      const suggestedName = normalizePastedChatroomName(workingDir);
      if (suggestedName) {
        await renameChatroom({ chatroomId, name: suggestedName });
      }
      onCreated(chatroomId);
    },
    [
      createTeamChatroom,
      onCreated,
      registerWorkspace,
      renameChatroom,
      selectedMachine,
      selectedMachineId,
    ]
  );

  // Prerequisites are validated before selecting the create workflow.
  // fallow-ignore-next-line complexity
  const handleCreate = useCallback(async () => {
    if (!selectedTeam || creating) return;
    const trimmedGithubUrl = githubUrl.trim();
    setError(null);

    if (!trimmedGithubUrl) {
      setCreating(true);
      try {
        onCreated(await createTeamChatroom());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create chatroom');
      } finally {
        setCreating(false);
      }
      return;
    }

    if (!parseGitHubOwnerRepo(trimmedGithubUrl)) {
      setError('Enter a valid GitHub repository URL');
      return;
    }
    if (!selectedMachineId) {
      setError('Select a machine');
      return;
    }
    if (!selectedMachineHasRoot) {
      setError('Set repository root in Agent Settings');
      return;
    }
    if (!selectedMachineConnected) {
      setError('Connect daemon on selected machine');
      return;
    }

    setCreating(true);
    setCloneStarted(true);
    try {
      await requestClone(selectedMachineId, trimmedGithubUrl);
    } catch (err) {
      setCloneStarted(false);
      setCreating(false);
      setError(err instanceof Error ? err.message : 'Failed to start repository clone');
    }
  }, [
    createTeamChatroom,
    creating,
    githubUrl,
    onCreated,
    requestClone,
    selectedMachineConnected,
    selectedMachineHasRoot,
    selectedMachineId,
    selectedTeam,
  ]);

  useEffect(() => {
    if (!cloneStarted) return;
    if (isTimedOut) {
      setError('Repository clone timed out. Ensure the daemon is running on the selected machine.');
      setCloneStarted(false);
      setCreating(false);
      resetClone();
      return;
    }
    if (!request || request.status === 'pending') return;

    setCloneStarted(false);
    if (request.status === 'failed') {
      setError(request.errorMessage ?? 'Repository clone failed');
      setCreating(false);
      resetClone();
      return;
    }
    if (!request.workingDir) {
      setError('Repository clone completed without a workspace folder');
      setCreating(false);
      resetClone();
      return;
    }

    const workingDir = request.workingDir;
    void createFromRepository(workingDir)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to create chatroom workspace');
      })
      .finally(() => {
        setCreating(false);
        resetClone();
      });
  }, [cloneStarted, createFromRepository, isTimedOut, request, resetClone]);

  const [isTeamPickerOpen, setIsTeamPickerOpen] = useState(false);
  const { searchTerm, setSearchTerm, handleOpenChange } = usePickerSearchState(setIsTeamPickerOpen);
  const filteredTeams = filterPickerItems(teams, searchTerm, (team) => team.name);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !isTeamPickerOpen && selectedTeam && !creating) {
        event.preventDefault();
        void handleCreate();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [creating, handleCreate, isTeamPickerOpen, selectedTeam]);

  const selectedTeamData = getById(selectedTeam);
  const canSubmitRepository =
    !githubUrl.trim() ||
    Boolean(selectedMachineId && selectedMachineHasRoot && selectedMachineConnected);

  return (
    <div className="bg-chatroom-bg-surface backdrop-blur-xl border-2 border-chatroom-border-strong w-full max-w-md mx-auto">
      <div className="p-6 border-b-2 border-chatroom-border">
        <h2 className="text-sm font-bold uppercase tracking-widest text-chatroom-text-primary m-0">
          Create New Chatroom
        </h2>
        <p className="text-chatroom-text-muted text-xs mt-2 m-0">
          Select a team, or clone a GitHub repository onto a connected machine.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
        className="flex flex-col gap-4 p-6"
      >
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
            Team
          </label>
          <ResponsivePickerShell
            open={isTeamPickerOpen}
            onOpenChange={handleOpenChange}
            title="Select team"
            align="start"
            contentClassName="w-72"
            trigger={
              <button
                type="button"
                className="bg-chatroom-bg-primary border-2 border-chatroom-border text-chatroom-text-primary h-auto p-3 text-sm focus:ring-0 focus:outline-none focus:border-chatroom-border-strong rounded-none w-full flex items-center justify-between"
              >
                <span className="truncate text-left flex-1">
                  {selectedTeamData ? selectedTeamData.name : 'Select team…'}
                </span>
              </button>
            }
          >
            <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search teams…" />
            <PickerScrollBody maxHeightClassName="max-h-60">
              {filteredTeams.length === 0 ? (
                <p className="px-3 py-2 text-xs text-chatroom-text-muted">No teams found.</p>
              ) : (
                filteredTeams.map((team) => (
                  <PickerOptionRow
                    key={team.id}
                    selected={selectedTeam === team.id}
                    onSelect={() => {
                      setSelectedTeam(team.id);
                      handleOpenChange(false);
                    }}
                  >
                    {team.name}
                  </PickerOptionRow>
                ))
              )}
            </PickerScrollBody>
          </ResponsivePickerShell>
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="github-repository-url"
            className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted"
          >
            GitHub Repository URL <span className="font-normal normal-case">(optional)</span>
          </label>
          <input
            id="github-repository-url"
            type="url"
            value={githubUrl}
            onChange={(event) => setGithubUrl(event.target.value)}
            placeholder="https://github.com/owner/repo"
            disabled={creating}
            className="bg-chatroom-bg-primary border-2 border-chatroom-border text-chatroom-text-primary h-auto p-3 text-sm focus:ring-0 focus:outline-none focus:border-chatroom-border-strong rounded-none w-full"
          />
        </div>

        {githubUrl.trim() && (
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
              Machine
            </label>
            {machines.length === 0 ? (
              <p className="text-xs text-chatroom-text-muted border border-chatroom-border p-3">
                No machines registered. Connect a daemon and configure a repository root in Agent
                Settings.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {machines.map((machine) => {
                  const connected = daemonConnectivity.get(machine.machineId)?.connected === true;
                  const hasRoot = Boolean(repositoryRoots[machine.machineId]);
                  return (
                    <MachineOption
                      key={machine.machineId}
                      machine={machine}
                      connected={connected}
                      hasRoot={hasRoot}
                      selected={selectedMachineId === machine.machineId}
                      disabled={!connected || !hasRoot || creating}
                      onSelect={() => setSelectedMachineId(machine.machineId)}
                    />
                  );
                })}
              </div>
            )}
            {repositoryRootsResult === undefined && (
              <p className="text-xs text-chatroom-text-muted">Loading repository roots…</p>
            )}
          </div>
        )}

        {selectedTeamData && !githubUrl.trim() && (
          <div className="bg-chatroom-bg-tertiary p-4 border-l-2 border-chatroom-border-strong">
            <div className="text-chatroom-text-secondary text-sm mb-3">
              {selectedTeamData.description}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedTeamData.roles.map((role) => (
                <span
                  key={role}
                  className="bg-chatroom-bg-hover px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted"
                >
                  {role}
                </span>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-chatroom-status-error/10 text-chatroom-status-error p-3 text-xs">
            {error}
          </div>
        )}

        <div className="pt-2 flex justify-end gap-3">
          <button
            type="button"
            className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary px-4 py-2 text-xs font-bold uppercase tracking-wide cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chatroom-accent"
            onClick={onCancel}
            disabled={creating}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="bg-chatroom-accent text-chatroom-bg-primary border-0 px-4 py-2 text-xs font-bold uppercase tracking-wide cursor-pointer transition-all duration-100 hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chatroom-accent"
            disabled={creating || !selectedTeam || !canSubmitRepository}
          >
            {cloneStarted || isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Cloning...
              </span>
            ) : creating ? (
              'Creating...'
            ) : (
              'Create Chatroom'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
