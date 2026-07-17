'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  Play,
  Square,
  RotateCw,
  Loader2,
  AlertCircle,
  ChevronDown,
  SlidersHorizontal,
  FileText,
} from 'lucide-react';
import React, { useState, useMemo, useCallback, memo, useEffect, useRef } from 'react';

import { PromptViewerModal, toTitleCase } from './AgentPanel/PromptViewerModal';
import { CopyButton } from './CopyButton';
import { MachineCapabilitiesRefreshButton } from './MachineCapabilitiesRefreshButton';
import { ModelFilterPanel } from './ModelFilterPanel';
import {
  ResponsivePickerShell,
  PickerSearch,
  PickerScrollBody,
  PickerOptionRow,
  usePickerSearchState,
  filterPickerItems,
} from './picker';
import { useMachineModels } from '../../../hooks/useMachineModels';
import { useMachineConfigFavorites } from '../features/machine-config/hooks/useMachineConfigFavorites';
import { useMachineConfigUsage } from '../features/machine-config/hooks/useMachineConfigUsage';
import { useTeamAgentBehaviorSettings } from '../hooks/useTeamAgentBehaviorSettings';
import { computeRecommendedMachineConfigs } from '../lib/computeRecommendedMachineConfigs';
import { buildMachineConfigScopeKey } from '../lib/teamRoleKey';
import type {
  AgentHarness,
  HarnessVersionInfo,
  MachineInfo,
  AgentConfig,
  SendCommandFn,
} from '../types/machine';
import {
  getHarnessDisplayName,
  getModelDisplayLabel,
  getMachineDisplayName,
} from '../types/machine';
import type { Workspace } from '../types/workspace';
import { isModelHidden, selectModel } from '../utils/modelSelection';
import { MachineConfigQuickPick } from './AgentPanel/MachineConfigQuickPick';
import { RemoteAgentAdvancedSettings } from './AgentPanel/RemoteAgentAdvancedSettings';
import { resolveDefaultWantResume } from '../utils/wantResumeDefaults';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { useChatroomWorkspaces } from '../workspace/hooks/useChatroomWorkspaces';

import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────

export interface AgentControlsProps {
  role: string;
  prompt: string;
  chatroomId: string;
  connectedMachines: MachineInfo[];
  agentConfigs: AgentConfig[];
  isLoadingMachines: boolean;
  daemonStartCommand: string;
  sendCommand: SendCommandFn;
}

function formatHarnessLabel(harness: string, version?: HarnessVersionInfo): string {
  return `${getHarnessDisplayName(harness)}${version ? ` v${version.version}` : ''}`;
}

// ─── Hook: useAgentControls ─────────────────────────────────────────
// Encapsulates all state + logic for machine/harness/model selection and
// start/stop/restart actions. Used by both the shared tab content and
// any container that needs programmatic access.
//
// INITIALIZATION MODEL
// ────────────────────
// Form state is initialized ONCE when machines first become available.
// The "last used" configuration comes from a single source — the persisted
// teamAgentConfigs (roleConfigs) — so the form reflects exactly what the agent
// was last started with. After initialization, all state changes come
// exclusively from explicit user interactions (handleMachineChange,
// handleHarnessChange, etc.) — never from reactive prop updates.
//
// DISPLAY WHEN RUNNING
// ─────────────────────
// When an agent is running (isAgentRunning), the display values shown in
// the form come directly from runningAgentConfig — not from internal state.
// Internal state is preserved and used when the agent stops.
//
// MODEL SELECTION
// ───────────────
// `selectedModel` is DERIVED (useMemo), not state. Per-harness user choices
// are stored in `userModelByHarness` so switching harness never loses context.

// ─── Pure helpers for initialization ────────────────────────────────

/** Exported for unit tests — deterministic machine pick; never falls back to arbitrary first online machine. */
export function deriveInitialMachineId(
  connectedMachines: MachineInfo[],
  roleConfigs: AgentConfig[],
  runningAgentConfig: AgentConfig | undefined
): string | null {
  if (connectedMachines.length === 0) return null;
  // Priority: running agent > existing config machine
  if (runningAgentConfig) return runningAgentConfig.machineId;
  const configMachine = connectedMachines.find((m) =>
    roleConfigs.some((c) => c.machineId === m.machineId)
  );
  if (configMachine) return configMachine.machineId;
  return null;
}

function deriveInitialHarness(
  machineId: string | null,
  connectedMachines: MachineInfo[],
  roleConfigs: AgentConfig[],
  teamConfigHarness?: AgentHarness
): AgentHarness | null {
  if (!machineId) return null;
  const machine = connectedMachines.find((m) => m.machineId === machineId);
  const available = machine?.availableHarnesses ?? [];
  // Priority: existing config harness > team config harness > only option
  const config = roleConfigs.find((c) => c.machineId === machineId);
  if (config && available.includes(config.agentType)) return config.agentType;
  if (teamConfigHarness && available.includes(teamConfigHarness)) return teamConfigHarness;
  if (available.length === 1) return available[0];
  return null;
}

export function deriveInitialWorkingDir(
  machineId: string | null,
  roleConfigs: AgentConfig[],
  chatroomWorkspaces?: Workspace[]
): string {
  if (machineId) {
    const config = roleConfigs.find((c) => c.machineId === machineId);
    if (config?.workingDir) return config.workingDir;
    if (chatroomWorkspaces) {
      const ws = chatroomWorkspaces.find((w) => w.machineId === machineId);
      if (ws?.workingDir) return ws.workingDir;
    }
  }
  if (roleConfigs.length > 0) {
    const latest = roleConfigs.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    if (latest.workingDir) return latest.workingDir;
  }
  return '';
}

/** True when one-shot init should wait for chatroom workspaces before resolving working dir. */
export function shouldDeferInitUntilWorkspacesLoad(
  machineId: string | null,
  roleConfigs: AgentConfig[]
): boolean {
  if (machineId) {
    const config = roleConfigs.find((c) => c.machineId === machineId);
    if (config?.workingDir) return false;
    return true;
  }
  if (roleConfigs.some((c) => c.workingDir)) return false;
  return false;
}

/**
 * Picks the initial resume-session toggle value from PERSISTED state so the
 * toggle reflects what the agent was last started with — even when the agent is
 * currently STOPPED and the page was just loaded (when `runningAgentConfig` is
 * undefined and the lock-step sync effect never fires).
 *
 * Without this seed the toggle falls back to the bare `true` form default, so a
 * config last started with `wantResume: false` would mislead the user with `true`
 * after a reload. We default to `true` ONLY when no persisted preference exists
 * (a genuinely new start) — never to mask a known value during load.
 *
 * Selection priority mirrors the other `deriveInitial*` helpers: running config →
 * the config for the chosen machine → the most-recently-updated config for the role.
 */
export function deriveInitialResumeSession(
  machineId: string | null,
  roleConfigs: AgentConfig[],
  runningAgentConfig: AgentConfig | undefined,
  teamId?: string,
  role?: string
): boolean {
  if (runningAgentConfig?.wantResume !== undefined) {
    return runningAgentConfig.wantResume;
  }
  const machineConfig = machineId ? roleConfigs.find((c) => c.machineId === machineId) : undefined;
  if (machineConfig?.wantResume !== undefined) {
    return machineConfig.wantResume;
  }
  if (roleConfigs.length > 0) {
    const latest = roleConfigs.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    if (latest.wantResume !== undefined) {
      return latest.wantResume;
    }
  }
  return resolveDefaultWantResume(teamId, role ?? '');
}

export function useAgentControls({
  role,
  chatroomId,
  connectedMachines,
  agentConfigs,
  sendCommand,
  teamConfigModel,
  teamConfigHarness,
  teamConfigMachineId,
  teamWantResume,
  chatroomWorkspaces,
  chatroomWorkspacesLoading,
  lockedMachineId,
  lockedWorkingDir,
  teamId,
}: {
  role: string;
  chatroomId: string;
  connectedMachines: MachineInfo[];
  agentConfigs: AgentConfig[];
  sendCommand: AgentControlsProps['sendCommand'];
  /** Model from team config — used as fallback when machine config has no model */
  teamConfigModel?: string;
  /** Harness from team config — used as a seeding hint for initialization when
   *  no roleConfig is found */
  teamConfigHarness?: AgentHarness;
  /** Team-config machine binding for this role (from team agent config / agent status view). */
  teamConfigMachineId?: string | null;
  /** Persisted reconnect-on-start preference from team agent config. */
  teamWantResume?: boolean;
  /** Team ID for role/team-specific defaults. */
  teamId?: string;
  /** Registered workspaces for this chatroom — used to auto-detect working dir when empty */
  chatroomWorkspaces?: Workspace[];
  /** When true, init defers until workspaces load if working dir may come from the registry */
  chatroomWorkspacesLoading?: boolean;
  /** Setup wizard: lock machine and working directory. */
  lockedMachineId?: string;
  lockedWorkingDir?: string;
}) {
  // Snapshot teamConfigHarness at mount — used as a seeding hint during initialization only
  const initialTeamConfigHarnessRef = useRef(teamConfigHarness);

  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedHarness, setSelectedHarness] = useState<AgentHarness | null>(null);
  // Per-harness user model choice. Keyed by AgentHarness string.
  const [userModelByHarness, setUserModelByHarness] = useState<
    Partial<Record<AgentHarness, string>>
  >({});
  const [workingDir, setWorkingDir] = useState<string>('');
  const teamBehavior = useTeamAgentBehaviorSettings({
    chatroomId,
    role,
    teamWantResume,
  });
  const { seedFromTeamConfig, effectiveWantResume } = teamBehavior;
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rehomeConfirmOpen, setRehomeConfirmOpen] = useState(false);
  // Guards initialization — fires exactly once when machines become available
  const [isInitialized, setIsInitialized] = useState(false);

  // Update the ref if it's still unset and teamConfigHarness arrives before initialization.
  // Safe to do in render: runs only before initialization, is a one-way undefined→defined
  // transition, and setting a ref does not trigger re-renders.
  if (
    !isInitialized &&
    initialTeamConfigHarnessRef.current === undefined &&
    teamConfigHarness !== undefined
  ) {
    initialTeamConfigHarnessRef.current = teamConfigHarness;
  }

  // Get configs for this role
  const roleConfigs = useMemo(() => {
    return agentConfigs.filter((c) => c.role.toLowerCase() === role.toLowerCase());
  }, [agentConfigs, role]);

  // Check if there's a running agent on a connected machine
  const runningAgentConfig = useMemo(() => {
    return roleConfigs.find(
      (c) => c.spawnedAgentPid && connectedMachines.some((m) => m.machineId === c.machineId)
    );
  }, [roleConfigs, connectedMachines]);

  // Get available harnesses for selected machine
  const availableHarnessesForMachine = useMemo(() => {
    if (!selectedMachineId) return [];
    const machine = connectedMachines.find((m) => m.machineId === selectedMachineId);
    return machine?.availableHarnesses || [];
  }, [selectedMachineId, connectedMachines]);

  // Get harness versions for selected machine
  const harnessVersionsForMachine = useMemo(() => {
    if (!selectedMachineId) return {} as Partial<Record<AgentHarness, HarnessVersionInfo>>;
    const machine = connectedMachines.find((m) => m.machineId === selectedMachineId);
    return machine?.harnessVersions || {};
  }, [selectedMachineId, connectedMachines]);

  // ── Single initialize-once effect ────────────────────────────────
  // Fires exactly once — when machines first become available.
  // The "last used" config is derived solely from the persisted teamAgentConfigs
  // (roleConfigs).
  useEffect(() => {
    if (isInitialized || connectedMachines.length === 0) return;

    // Single source of truth for "last used": persisted teamAgentConfigs.
    const machine =
      lockedMachineId ?? deriveInitialMachineId(connectedMachines, roleConfigs, runningAgentConfig);
    if (chatroomWorkspacesLoading && shouldDeferInitUntilWorkspacesLoad(machine, roleConfigs)) {
      return;
    }
    const harness = deriveInitialHarness(
      machine,
      connectedMachines,
      roleConfigs,
      initialTeamConfigHarnessRef.current
    );
    const wd =
      lockedWorkingDir ?? deriveInitialWorkingDir(machine, roleConfigs, chatroomWorkspaces);

    setSelectedMachineId(machine);
    setSelectedHarness(harness);
    setWorkingDir(wd);
    seedFromTeamConfig({
      wantResume: deriveInitialResumeSession(
        machine,
        roleConfigs,
        runningAgentConfig,
        teamId,
        role
      ),
    });
    setIsInitialized(true);
  }, [
    isInitialized,
    connectedMachines,
    roleConfigs,
    runningAgentConfig,
    chatroomWorkspaces,
    chatroomWorkspacesLoading,
    seedFromTeamConfig,
    lockedMachineId,
    lockedWorkingDir,
  ]);

  // ── Display the persisted preference for next start ──
  // The toggle shows `effectiveWantResume` from teamBehavior, which reflects
  // the persisted `setWantResume` preference. While running, the toggle remains
  // editable so the user can change the preference before the next start.

  // Available models from the selected machine filtered by selected harness
  const { availableModels: machineModels, isLoading: machineModelsLoading } = useMachineModels(
    selectedMachineId ?? undefined
  );
  const availableModelsForHarness = useMemo(
    () => (selectedMachineId && selectedHarness ? (machineModels[selectedHarness] ?? []) : []),
    [machineModels, selectedMachineId, selectedHarness]
  );

  // Machine-level model filter — used to exclude blacklisted models from
  // automatic selection and the model combobox.
  const machineModelFilterResult = useSessionQuery(
    api.machines.getMachineModelFilters,
    selectedMachineId && selectedHarness
      ? { machineId: selectedMachineId, agentHarness: selectedHarness }
      : 'skip'
  );
  const machineModelFilter = machineModelFilterResult ?? null;
  const machineModelFilterLoading =
    !!selectedMachineId && !!selectedHarness && machineModelFilterResult === undefined;

  // Wait for async machine models + filter before deriving selection — avoids flashing
  // a stale model label when switching machines or harnesses.
  const modelSelectionReady =
    !!selectedMachineId && !!selectedHarness && !machineModelsLoading && !machineModelFilterLoading;

  // Visible models = available models minus those hidden by the filter.
  // The combobox and automatic model selection use this list.
  const visibleModels = useMemo(
    () => availableModelsForHarness.filter((m) => !isModelHidden(m, machineModelFilter)),
    [availableModelsForHarness, machineModelFilter]
  );

  // ── Derived model selection ──────────────────────────────────────
  // selectedModel is a pure derivation — no useEffect, no setState.
  // Uses the extracted selectModel utility for testability.
  const selectedModel = useMemo((): string | null => {
    if (!modelSelectionReady) return null;
    // Machine config model — only if it's saved under the same harness type
    const config = roleConfigs.find(
      (c) => c.machineId === selectedMachineId && c.agentType === selectedHarness && c.model
    );

    return selectModel({
      selectedHarness,
      availableModels: availableModelsForHarness,
      visibleModels,
      userChoice: selectedHarness ? userModelByHarness[selectedHarness] : undefined,
      machineConfigModel: config?.model ?? undefined,
      teamConfigModel,
    });
  }, [
    modelSelectionReady,
    selectedHarness,
    availableModelsForHarness,
    visibleModels,
    userModelByHarness,
    roleConfigs,
    selectedMachineId,
    teamConfigModel,
  ]);

  const isAgentRunning = !!runningAgentConfig;
  const isBusy = isStarting || isStopping;
  const hasModels = availableModelsForHarness.length > 0;
  const canStart =
    !!selectedMachineId &&
    !!selectedHarness &&
    (!hasModels || selectedModel) &&
    workingDir.trim() &&
    !isStarting &&
    !isAgentRunning &&
    !success;

  const rehomeDialogLabels = useMemo(() => {
    if (!teamConfigMachineId || !selectedMachineId) return null;
    const prevM = connectedMachines.find((m) => m.machineId === teamConfigMachineId);
    const nextM = connectedMachines.find((m) => m.machineId === selectedMachineId);
    return {
      previous: prevM ? getMachineDisplayName(prevM) : teamConfigMachineId,
      next: nextM ? getMachineDisplayName(nextM) : selectedMachineId,
    };
  }, [teamConfigMachineId, selectedMachineId, connectedMachines]);
  const canStop = isAgentRunning && !isStopping && !success;
  const canRestart = isAgentRunning && !isStopping && !isStarting && !success;

  const machineConfigScopeKeyForControls = useMemo(
    () =>
      selectedMachineId && teamId
        ? buildMachineConfigScopeKey(selectedMachineId, chatroomId, teamId, role)
        : undefined,
    [selectedMachineId, chatroomId, teamId, role]
  );
  const { recordUsage: recordMachineConfigUsage } = useMachineConfigUsage(
    machineConfigScopeKeyForControls
  );

  const executeStartAgent = useCallback(
    async (allowNewMachine?: boolean) => {
      if (!selectedMachineId || !selectedHarness) return;
      setIsStarting(true);
      setError(null);
      try {
        await sendCommand({
          machineId: selectedMachineId,
          type: 'start-agent',
          payload: {
            chatroomId: chatroomId as Id<'chatroom_rooms'>,
            role,
            model: selectedModel || undefined,
            agentHarness: selectedHarness,
            workingDir: workingDir.trim() || undefined,
            wantResume: effectiveWantResume,
            ...(allowNewMachine ? { allowNewMachine: true as const } : {}),
          },
        });
        if (selectedHarness && selectedModel) {
          recordMachineConfigUsage({
            agentHarness: selectedHarness,
            model: selectedModel,
          });
        }
        setSuccess('Start command sent!');
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start agent');
      } finally {
        setIsStarting(false);
      }
    },
    [
      selectedMachineId,
      selectedHarness,
      selectedModel,
      workingDir,
      effectiveWantResume,
      sendCommand,
      chatroomId,
      role,
      recordMachineConfigUsage,
    ]
  );

  const handleStartAgent = useCallback(() => {
    if (!selectedMachineId || !selectedHarness) return;
    const isRehome = teamConfigMachineId != null && selectedMachineId !== teamConfigMachineId;
    if (isRehome) {
      setRehomeConfirmOpen(true);
      return;
    }
    void executeStartAgent();
  }, [selectedMachineId, selectedHarness, teamConfigMachineId, executeStartAgent]);

  const handleConfirmRehomeStart = useCallback(() => {
    setRehomeConfirmOpen(false);
    void executeStartAgent(true);
  }, [executeStartAgent]);

  const handleCancelRehomeStart = useCallback(() => {
    setRehomeConfirmOpen(false);
  }, []);

  const handleStopAgent = useCallback(async () => {
    if (!runningAgentConfig) return;
    setIsStopping(true);
    setError(null);
    try {
      await sendCommand({
        machineId: runningAgentConfig.machineId,
        type: 'stop-agent',
        payload: { chatroomId: chatroomId as Id<'chatroom_rooms'>, role },
      });
      setSuccess('Stop command sent!');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop agent');
    } finally {
      setIsStopping(false);
    }
  }, [runningAgentConfig, sendCommand, chatroomId, role]);

  const handleRestartAgent = useCallback(async () => {
    if (!runningAgentConfig) return;
    setIsStarting(true);
    setError(null);
    try {
      await sendCommand({
        machineId: runningAgentConfig.machineId,
        type: 'restart-agent',
        payload: {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          model: selectedModel || undefined,
          agentHarness: runningAgentConfig.agentType,
          workingDir: runningAgentConfig.workingDir,
          wantResume: runningAgentConfig.wantResume ?? effectiveWantResume,
        },
      });
      setSuccess('Restart command sent!');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart agent');
    } finally {
      setIsStarting(false);
    }
  }, [runningAgentConfig, selectedModel, effectiveWantResume, sendCommand, chatroomId, role]);

  // Wrapper for machine change — clears harness, per-harness model memory, and re-initializes for new machine
  const handleMachineChange = useCallback(
    (machineId: string | null) => {
      if (lockedMachineId) return;
      setSelectedMachineId(machineId);
      setSelectedHarness(null);
      setUserModelByHarness({});
      const wd = deriveInitialWorkingDir(machineId, roleConfigs, chatroomWorkspaces);
      setWorkingDir(wd);
    },
    [roleConfigs, chatroomWorkspaces, lockedMachineId]
  );

  // Wrapper for harness change — does NOT clear other harnesses' model memory,
  // and does NOT reset wantResume so the user's preference persists across harness switches.
  const handleHarnessChange = useCallback((harness: AgentHarness | null) => {
    setSelectedHarness(harness);
  }, []);

  // Wrapper for user manually selecting a model — stored per harness
  const handleModelChange = useCallback(
    (model: string | null) => {
      if (!selectedHarness) return;
      if (model) {
        setUserModelByHarness((prev) => ({ ...prev, [selectedHarness]: model }));
      } else {
        setUserModelByHarness((prev) => {
          const next = { ...prev };
          delete next[selectedHarness];
          return next;
        });
      }
    },
    [selectedHarness]
  );

  // Wrapper for user manually changing working directory
  const handleWorkingDirChange = useCallback(
    (dir: string) => {
      if (lockedWorkingDir) return;
      setWorkingDir(dir);
    },
    [lockedWorkingDir]
  );

  return {
    selectedMachineId,
    selectedHarness,
    selectedModel,
    workingDir,
    teamBehavior,
    isStarting,
    isStopping,
    error,
    success,
    roleConfigs,
    runningAgentConfig,
    availableHarnessesForMachine,
    harnessVersionsForMachine,
    availableModelsForHarness,
    visibleModels,
    machineModelFilter,
    isAgentRunning,
    isBusy,
    hasModels,
    canStart,
    canStop,
    canRestart,
    handleStartAgent,
    handleStopAgent,
    handleRestartAgent,
    handleMachineChange,
    handleHarnessChange,
    handleModelChange,
    handleWorkingDirChange,
    rehomeConfirmOpen,
    rehomeDialogLabels,
    handleConfirmRehomeStart,
    handleCancelRehomeStart,
    teamId,
  };
}

// ─── Component: RemoteTabContent ────────────────────────────────────
// The "Remote" tab UI: machine selection, harness, model, working dir,
// start/stop/restart buttons.

interface RemoteTabContentProps {
  controls: ReturnType<typeof useAgentControls>;
  connectedMachines: MachineInfo[];
  isLoadingMachines: boolean;
  daemonStartCommand: string;
  chatroomId: string;
  role: string;
  /** When provided, skips a duplicate workspace registry subscription in this tab. */
  linkedMachineIds?: ReadonlySet<string>;
  setupMode?: boolean;
}

export const RemoteTabContent = memo(function RemoteTabContent({
  controls,
  connectedMachines,
  isLoadingMachines,
  daemonStartCommand,
  chatroomId,
  role,
  linkedMachineIds: linkedMachineIdsProp,
  setupMode = false,
}: RemoteTabContentProps) {
  const {
    selectedMachineId,
    selectedHarness,
    selectedModel,
    workingDir,
    isStarting,
    isStopping,
    availableHarnessesForMachine,
    harnessVersionsForMachine,
    availableModelsForHarness,
    runningAgentConfig,
    isAgentRunning,
    isBusy,
    teamId,
    hasModels,
    canStart,
    canStop,
    canRestart,
    handleStartAgent,
    handleStopAgent,
    handleRestartAgent,
    handleMachineChange,
    handleHarnessChange,
    handleModelChange,
    handleWorkingDirChange,
    teamBehavior,
    rehomeConfirmOpen,
    rehomeDialogLabels,
    handleConfirmRehomeStart,
    handleCancelRehomeStart,
  } = controls;

  // When an agent is running, display values come exclusively from runningAgentConfig.
  // Internal form state is preserved so it's ready again when the agent stops.
  const runningConfig = isAgentRunning ? runningAgentConfig : undefined;
  const displayMachineId = runningConfig?.machineId ?? selectedMachineId;
  const displayHarness = runningConfig?.agentType ?? selectedHarness;
  const displayModel = runningConfig?.model ?? selectedModel;
  const displayWorkingDir = runningConfig?.workingDir ?? workingDir;
  // Always show the persisted preference for next start (not the running agent's value).
  const displayResumeSession = teamBehavior.effectiveWantResume;

  // Machine config favorites + recommendations (scoped by machine+team+role)
  const favoriteScope = useMemo(() => {
    if (!displayMachineId || !teamId) return undefined;
    return { machineId: displayMachineId, chatroomId, teamId, role };
  }, [displayMachineId, chatroomId, teamId, role]);

  const machineConfigScopeKey = useMemo(
    () =>
      favoriteScope
        ? buildMachineConfigScopeKey(
            favoriteScope.machineId,
            favoriteScope.chatroomId,
            favoriteScope.teamId,
            favoriteScope.role
          )
        : undefined,
    [favoriteScope]
  );

  const { favorites, addFavorite, removeFavorite, moveFavorite, isFavorite } =
    useMachineConfigFavorites(favoriteScope);

  const {
    usageForScope: machineConfigUsage,
    recordUsage: recordMachineConfigUsageOnApply,
    clearUsage: clearMachineConfigUsage,
  } = useMachineConfigUsage(machineConfigScopeKey);

  const recommended = useMemo(() => {
    if (!machineConfigScopeKey) return [];
    const usage = machineConfigUsage;
    const candidates: { agentHarness: AgentHarness; model: string }[] = [];

    // Build candidates from favorites + current selection + available harnesses/models
    for (const fav of favorites) {
      if (availableHarnessesForMachine.includes(fav.agentHarness as AgentHarness)) {
        candidates.push(fav);
      }
    }
    if (displayHarness && displayModel) {
      candidates.push({ agentHarness: displayHarness, model: displayModel });
    }
    // Add from usage keys that are still valid
    for (const key of usage.keys()) {
      const [harness, model] = key.split('|');
      if (harness && model && availableHarnessesForMachine.includes(harness as AgentHarness)) {
        candidates.push({ agentHarness: harness as AgentHarness, model });
      }
    }

    return computeRecommendedMachineConfigs(usage, favorites, candidates);
  }, [
    machineConfigScopeKey,
    machineConfigUsage,
    displayHarness,
    displayModel,
    favorites,
    availableHarnessesForMachine,
  ]);

  const handleApplyMachineConfig = useCallback(
    (entry: { agentHarness: AgentHarness; model: string }) => {
      handleModelChange(entry.model);
      handleHarnessChange(entry.agentHarness);
      recordMachineConfigUsageOnApply(entry);
    },
    [handleHarnessChange, handleModelChange, recordMachineConfigUsageOnApply]
  );

  const handleDismissRecommended = useCallback(
    (entry: { agentHarness: AgentHarness; model: string }) => {
      clearMachineConfigUsage(entry);
    },
    [clearMachineConfigUsage]
  );

  // Harness version lookup must use `displayMachineId` — when an agent is running,
  // `selectedMachineId` (form state) may still point to the same machine, but
  // `runningAgentConfig.machineId` is authoritative and may differ. Using
  // `displayMachineId` ensures the version label is always consistent with the
  // harness shown in the button.
  const displayHarnessVersionsForMachine = useMemo(() => {
    if (!displayMachineId) return {} as Partial<Record<AgentHarness, HarnessVersionInfo>>;
    const machine = connectedMachines.find((m) => m.machineId === displayMachineId);
    return machine?.harnessVersions ?? {};
  }, [displayMachineId, connectedMachines]);

  const hasNoMachines = !isLoadingMachines && connectedMachines.length === 0;

  const { workspaces: chatroomWorkspaces } = useChatroomWorkspaces(chatroomId, {
    skip: linkedMachineIdsProp !== undefined,
  });
  const linkedMachineIds = useMemo(() => {
    if (linkedMachineIdsProp !== undefined) return linkedMachineIdsProp;
    const s = new Set<string>();
    for (const ws of chatroomWorkspaces) {
      if (ws.machineId) s.add(ws.machineId);
    }
    return s;
  }, [linkedMachineIdsProp, chatroomWorkspaces]);

  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const {
    searchTerm: modelSearch,
    setSearchTerm: setModelSearch,
    handleOpenChange: handleModelOpenChange,
  } = usePickerSearchState(setModelPopoverOpen);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [machinePopoverOpen, setMachinePopoverOpen] = useState(false);
  const [harnessPopoverOpen, setHarnessPopoverOpen] = useState(false);
  const {
    searchTerm: machineSearch,
    setSearchTerm: setMachineSearch,
    handleOpenChange: handleMachineOpenChange,
  } = usePickerSearchState(setMachinePopoverOpen);
  const {
    searchTerm: harnessSearch,
    setSearchTerm: setHarnessSearch,
    handleOpenChange: handleHarnessOpenChange,
  } = usePickerSearchState(setHarnessPopoverOpen);

  const filteredMachines = useMemo(
    () => filterPickerItems(connectedMachines, machineSearch, (m) => getMachineDisplayName(m)),
    [connectedMachines, machineSearch]
  );

  const filteredHarnesses = useMemo(
    () =>
      filterPickerItems(availableHarnessesForMachine, harnessSearch, (harness) =>
        formatHarnessLabel(harness, harnessVersionsForMachine[harness])
      ),
    [availableHarnessesForMachine, harnessSearch, harnessVersionsForMachine]
  );

  // Load machine-level model filters for the selected machine + harness
  const machineModelFilter = useSessionQuery(
    api.machines.getMachineModelFilters,
    displayMachineId && displayHarness
      ? { machineId: displayMachineId, agentHarness: displayHarness }
      : 'skip'
  );

  const upsertModelFilter = useSessionMutation(api.machines.upsertMachineModelFilters);

  const handleFilterChange = useCallback(
    (hiddenModels: string[], hiddenProviders: string[]) => {
      if (!displayMachineId || !displayHarness) return;
      upsertModelFilter({
        machineId: displayMachineId,
        agentHarness: displayHarness,
        hiddenModels,
        hiddenProviders,
      });
    },
    [displayMachineId, displayHarness, upsertModelFilter]
  );

  // Compute visible models (exclude hidden models entirely from combobox)
  const visibleModels = useMemo(
    () => availableModelsForHarness.filter((m) => !isModelHidden(m, machineModelFilter)),
    [availableModelsForHarness, machineModelFilter]
  );

  const filteredModels = useMemo(
    () => filterPickerItems(visibleModels, modelSearch, (m) => getModelDisplayLabel(m)),
    [visibleModels, modelSearch]
  );

  // True when the currently selected model exists in the full list but is filtered out
  const isSelectedModelHidden = useMemo(
    () =>
      !!(
        displayModel &&
        availableModelsForHarness.includes(displayModel) &&
        !visibleModels.includes(displayModel)
      ),
    [displayModel, availableModelsForHarness, visibleModels]
  );

  return (
    <div className="space-y-2">
      {isLoadingMachines ? (
        <div className="flex items-center justify-center py-1">
          <Loader2 size={14} className="animate-spin text-chatroom-text-muted" />
          <span className="ml-2 text-[10px] text-chatroom-text-muted">Loading machines...</span>
        </div>
      ) : hasNoMachines ? (
        <div className="space-y-2 py-1">
          <div className="flex items-center gap-2">
            <AlertCircle size={12} className="text-chatroom-status-warning flex-shrink-0" />
            <span className="text-[10px] text-chatroom-text-secondary">
              No machines online. Run:
            </span>
          </div>
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
      ) : (
        <>
          {/* Row 1: Machine + Harness */}
          <div className="flex items-start gap-2">
            {!setupMode && (
              <div className="flex-1 min-w-0">
                {isAgentRunning ? (
                  <div className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 opacity-50 truncate">
                    {displayMachineId
                      ? (() => {
                          const m = connectedMachines.find((m) => m.machineId === displayMachineId);
                          return m ? getMachineDisplayName(m) : displayMachineId;
                        })()
                      : 'Machine...'}
                  </div>
                ) : (
                  <ResponsivePickerShell
                    open={machinePopoverOpen}
                    onOpenChange={handleMachineOpenChange}
                    disabled={isBusy}
                    title="Select machine"
                    align="start"
                    contentClassName="w-72"
                    trigger={
                      <button
                        disabled={isBusy}
                        className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 h-auto hover:border-chatroom-border-strong focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
                        title="Select Machine"
                      >
                        <span className="truncate">
                          {displayMachineId
                            ? (() => {
                                const m = connectedMachines.find(
                                  (m) => m.machineId === displayMachineId
                                );
                                return m ? getMachineDisplayName(m) : displayMachineId;
                              })()
                            : 'Machine...'}
                        </span>
                        <ChevronDown
                          size={10}
                          className="ml-1 flex-shrink-0 text-chatroom-text-muted"
                        />
                      </button>
                    }
                  >
                    <PickerSearch
                      value={machineSearch}
                      onChange={setMachineSearch}
                      placeholder="Search machines…"
                    />
                    <PickerScrollBody maxHeightClassName="max-h-60">
                      {filteredMachines.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-chatroom-text-muted">
                          No machines found.
                        </p>
                      ) : (
                        filteredMachines.map((machine) => (
                          <PickerOptionRow
                            key={machine.machineId}
                            selected={displayMachineId === machine.machineId}
                            onSelect={() => {
                              handleMachineChange(machine.machineId);
                              handleMachineOpenChange(false);
                            }}
                          >
                            {getMachineDisplayName(machine)}
                          </PickerOptionRow>
                        ))
                      )}
                    </PickerScrollBody>
                  </ResponsivePickerShell>
                )}
              </div>
            )}
            <div className="flex-1 min-w-0 flex items-stretch gap-1">
              <div className="min-w-0 flex-1">
                {isAgentRunning ? (
                  <div className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 opacity-50 truncate">
                    {displayHarness
                      ? formatHarnessLabel(
                          displayHarness,
                          displayHarnessVersionsForMachine[displayHarness]
                        )
                      : 'Harness...'}
                  </div>
                ) : (
                  <ResponsivePickerShell
                    open={harnessPopoverOpen}
                    onOpenChange={handleHarnessOpenChange}
                    disabled={
                      isBusy || !displayMachineId || availableHarnessesForMachine.length === 0
                    }
                    title="Select harness"
                    align="start"
                    contentClassName="w-72"
                    trigger={
                      <button
                        disabled={
                          isBusy || !displayMachineId || availableHarnessesForMachine.length === 0
                        }
                        className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 h-auto hover:border-chatroom-border-strong focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
                        title="Select Harness"
                      >
                        <span className="truncate flex items-center min-w-0">
                          {displayHarness
                            ? formatHarnessLabel(
                                displayHarness,
                                displayHarnessVersionsForMachine[displayHarness]
                              )
                            : 'Harness...'}
                        </span>
                        <ChevronDown
                          size={10}
                          className="ml-1 flex-shrink-0 text-chatroom-text-muted"
                        />
                      </button>
                    }
                  >
                    <PickerSearch
                      value={harnessSearch}
                      onChange={setHarnessSearch}
                      placeholder="Search harnesses…"
                    />
                    <PickerScrollBody maxHeightClassName="max-h-60">
                      {filteredHarnesses.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-chatroom-text-muted">
                          No harnesses found.
                        </p>
                      ) : (
                        filteredHarnesses.map((harness) => {
                          const label = formatHarnessLabel(
                            harness,
                            harnessVersionsForMachine[harness]
                          );
                          return (
                            <PickerOptionRow
                              key={harness}
                              selected={displayHarness === harness}
                              onSelect={() => {
                                handleHarnessChange(harness);
                                handleHarnessOpenChange(false);
                              }}
                            >
                              {label}
                            </PickerOptionRow>
                          );
                        })
                      )}
                    </PickerScrollBody>
                  </ResponsivePickerShell>
                )}
              </div>
              {displayMachineId ? (
                <MachineCapabilitiesRefreshButton
                  chatroomId={chatroomId}
                  machineId={displayMachineId}
                  daemonConnected={connectedMachines.some((m) => m.machineId === displayMachineId)}
                  linkedToChatroom={linkedMachineIds.has(displayMachineId)}
                />
              ) : null}
            </div>
          </div>

          {/* Row 2: Working Directory */}
          {!setupMode && (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={displayWorkingDir}
                onChange={(e) => handleWorkingDirChange(e.target.value)}
                placeholder="/path/to/project"
                disabled={isBusy || isAgentRunning}
                className="flex-1 bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-mono text-chatroom-text-primary px-2 py-1.5 placeholder:text-chatroom-text-muted/50 focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed"
                title="Working directory for agent (absolute path on remote machine)"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
              {displayWorkingDir.trim() && (
                <CopyButton
                  text={displayWorkingDir.trim()}
                  label="Copy Path"
                  copiedLabel="Copied!"
                  variant="compact"
                />
              )}
            </div>
          )}

          {!setupMode &&
            !isAgentRunning &&
            !selectedMachineId &&
            connectedMachines.length > 0 &&
            !isLoadingMachines && (
              <p className="text-[10px] text-muted-foreground">
                Select a machine to start this agent.
              </p>
            )}

          {/* Row 3: Model + Start/Stop */}
          <div className="flex items-center gap-2">
            {hasModels ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                {isAgentRunning ? (
                  <div className="flex-1 min-w-0">
                    <div
                      className={cn(
                        'w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 opacity-50 flex items-center justify-between',
                        isSelectedModelHidden && 'text-chatroom-status-warning'
                      )}
                    >
                      <span className="truncate">
                        {displayModel ? getModelDisplayLabel(displayModel) : 'Model...'}
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {isSelectedModelHidden && (
                          <AlertCircle
                            size={10}
                            className="text-chatroom-status-warning flex-shrink-0"
                            aria-label="Selected model is hidden by filter — choose a new model"
                          />
                        )}
                        {machineModelFilter &&
                          (machineModelFilter.hiddenModels.length > 0 ||
                            machineModelFilter.hiddenProviders.length > 0) && (
                            <div
                              className="w-1.5 h-1.5 bg-chatroom-accent"
                              title="Some models are hidden"
                            />
                          )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <ResponsivePickerShell
                      open={modelPopoverOpen}
                      onOpenChange={handleModelOpenChange}
                      disabled={isBusy || !displayHarness}
                      title="Select model"
                      align="start"
                      contentClassName="w-[420px]"
                      trigger={
                        <button
                          type="button"
                          disabled={isBusy || !displayHarness}
                          aria-label="Select model"
                          className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 h-auto hover:border-chatroom-border-strong focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
                          title="Select Model"
                        >
                          <span
                            className={cn(
                              'truncate',
                              isSelectedModelHidden && 'text-chatroom-status-warning'
                            )}
                          >
                            {displayModel ? getModelDisplayLabel(displayModel) : 'Model...'}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {isSelectedModelHidden && (
                              <AlertCircle
                                size={10}
                                className="text-chatroom-status-warning flex-shrink-0"
                                aria-label="Selected model is hidden by filter — choose a new model"
                              />
                            )}
                            {machineModelFilter &&
                              (machineModelFilter.hiddenModels.length > 0 ||
                                machineModelFilter.hiddenProviders.length > 0) && (
                                <div
                                  className="w-1.5 h-1.5 bg-chatroom-accent"
                                  title="Some models are hidden"
                                />
                              )}
                            <ChevronDown size={10} className="text-chatroom-text-muted" />
                          </div>
                        </button>
                      }
                    >
                      <PickerSearch
                        value={modelSearch}
                        onChange={setModelSearch}
                        placeholder="Search models…"
                      />
                      <PickerScrollBody maxHeightClassName="max-h-60">
                        {filteredModels.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-chatroom-text-muted">
                            No models found.
                          </p>
                        ) : (
                          filteredModels.map((model) => (
                            <PickerOptionRow
                              key={model}
                              selected={displayModel === model}
                              onSelect={() => {
                                handleModelChange(model);
                                handleModelOpenChange(false);
                              }}
                            >
                              {getModelDisplayLabel(model)}
                            </PickerOptionRow>
                          ))
                        )}
                      </PickerScrollBody>
                    </ResponsivePickerShell>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1" />
            )}

            {displayMachineId && displayHarness && (
              <ModelFilterPanel
                open={filterPanelOpen}
                onOpenChange={setFilterPanelOpen}
                trigger={
                  <button
                    type="button"
                    disabled={isBusy}
                    className="w-7 h-7 flex items-center justify-center bg-chatroom-bg-tertiary border border-chatroom-border text-chatroom-text-muted hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                    title="Filter models"
                  >
                    <SlidersHorizontal size={10} />
                  </button>
                }
                availableModels={availableModelsForHarness}
                filter={machineModelFilter}
                onFilterChange={handleFilterChange}
                disabled={isBusy}
              />
            )}

            {/* Action Buttons */}
            {!setupMode && (
              <div className="flex items-center gap-1 flex-shrink-0">
                {isAgentRunning ? (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStopAgent();
                      }}
                      disabled={!canStop}
                      className={`w-7 h-7 flex items-center justify-center transition-all ${
                        canStop
                          ? 'text-chatroom-status-error hover:bg-chatroom-status-error/10'
                          : 'text-chatroom-text-muted cursor-not-allowed opacity-50'
                      }`}
                      title="Stop Agent"
                    >
                      {isStopping ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Square size={14} />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRestartAgent();
                      }}
                      disabled={!canRestart}
                      className={`w-7 h-7 flex items-center justify-center transition-all ${
                        canRestart
                          ? 'text-chatroom-status-info hover:bg-chatroom-status-info/10'
                          : 'text-chatroom-text-muted cursor-not-allowed opacity-50'
                      }`}
                      title="Restart Agent"
                    >
                      {isStarting ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <RotateCw size={14} />
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartAgent();
                    }}
                    disabled={!canStart}
                    className={`w-7 h-7 flex items-center justify-center transition-all ${
                      canStart
                        ? 'text-chatroom-status-success hover:bg-chatroom-status-success/10'
                        : 'text-chatroom-text-muted cursor-not-allowed opacity-50'
                    }`}
                    title="Start Agent"
                  >
                    {isStarting ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {displayMachineId && !setupMode && (
            <MachineConfigQuickPick
              favorites={favorites}
              recommended={recommended}
              currentHarness={displayHarness}
              currentModel={displayModel}
              disabled={isBusy}
              onApply={handleApplyMachineConfig}
              onToggleFavorite={(entry) => {
                if (isFavorite(entry)) {
                  void removeFavorite(entry);
                } else {
                  void addFavorite(entry);
                }
              }}
              onRemoveFavorite={(entry) => void removeFavorite(entry)}
              onMoveFavorite={(from, to) => void moveFavorite(from, to)}
              onDismissRecommended={handleDismissRecommended}
              isFavorite={isFavorite}
            />
          )}

          <RemoteAgentAdvancedSettings
            role={role}
            teamId={teamId}
            agentHarness={displayHarness}
            resumeSession={displayResumeSession}
            disabled={isBusy}
            isSavingWantResume={teamBehavior.isSavingWantResume}
            onResumeSessionChange={(checked) => void teamBehavior.updateWantResume(checked)}
          />

          <AlertDialog
            open={rehomeConfirmOpen}
            onOpenChange={(open) => {
              if (!open) handleCancelRehomeStart();
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Move agent to another machine?</AlertDialogTitle>
                <AlertDialogDescription>
                  {rehomeDialogLabels ? (
                    <>
                      Starting this agent will move the role from{' '}
                      <span className="font-semibold text-chatroom-text-primary">
                        {rehomeDialogLabels.previous}
                      </span>{' '}
                      to{' '}
                      <span className="font-semibold text-chatroom-text-primary">
                        {rehomeDialogLabels.next}
                      </span>
                      . Existing work on the old machine will continue until it exits. Continue?
                    </>
                  ) : (
                    'Existing work on the old machine will continue until it exits. Continue?'
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={handleCancelRehomeStart}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmRehomeStart}>Continue</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
});

// ─── Component: CustomTabContent ────────────────────────────────────
// The "Custom" tab UI: prompt preview with copy button.

interface CustomTabContentProps {
  role: string;
  prompt: string;
}

export const CustomTabContent = memo(function CustomTabContent({
  role,
  prompt,
}: CustomTabContentProps) {
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <>
      {/* Single prompt row — uses div instead of button to avoid nesting CopyButton's <button> inside a <button> */}
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center gap-2 text-left hover:bg-chatroom-bg-hover transition-colors px-2 py-2 -mx-2 cursor-pointer"
        onClick={() => setViewerOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setViewerOpen(true);
          }
        }}
      >
        <FileText size={14} className="text-chatroom-text-muted flex-shrink-0" />
        <span className="flex-1 text-[12px] font-medium text-chatroom-text-secondary">
          {toTitleCase(role)} Prompt
        </span>
        <div onClick={(e) => e.stopPropagation()}>
          <CopyButton text={prompt} label="Copy" copiedLabel="Copied!" variant="compact" />
        </div>
      </div>

      {/* Prompt viewer modal */}
      <PromptViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        role={role}
        prompt={prompt}
      />
    </>
  );
});
