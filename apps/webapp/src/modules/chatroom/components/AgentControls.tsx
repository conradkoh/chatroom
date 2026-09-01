'use client';
/* eslint-disable react-hooks/exhaustive-deps, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change, react-you-might-not-need-an-effect/no-chain-state-updates, react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-derived-state */

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import {
  Play,
  Square,
  RotateCw,
  Loader2,
  AlertCircle,
  ChevronDown,
  FileText,
  Plus,
  Star,
} from 'lucide-react';
import React, { useState, useMemo, useCallback, memo, useEffect, useRef } from 'react';

import type { AgentRoleView } from '../hooks/useAgentPanelData';
import { MachineConfigQuickPick } from './AgentPanel/MachineConfigQuickPick';
import { PromptViewerModal, toTitleCase } from './AgentPanel/PromptViewerModal';
import { CopyButton } from './CopyButton';
import { MachineCapabilitiesRefreshButton } from './MachineCapabilitiesRefreshButton';
import {
  ModelFilterButton,
  ModelPickerField,
  ModelPickerMeta,
  useHarnessModelPicker,
  useMachineModelFilter,
} from './model-selection';
import {
  ResponsivePickerShell,
  PickerSearch,
  PickerScrollBody,
  PickerOptionRow,
  usePickerSearchState,
  filterPickerItems,
} from './picker';
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
import { useMachineModels } from '../../../hooks/useMachineModels';
import { useMachineConfigFavorites } from '../features/machine-config/hooks/useMachineConfigFavorites';
import { useMachineConfigUsage } from '../features/machine-config/hooks/useMachineConfigUsage';
import { computeRecommendedMachineConfigs } from '../features/machine-config/lib/computeRecommendedMachineConfigs';
import { buildMachineConfigScopeKey } from '../features/machine-config/lib/machineConfigScopeKey';
import { isActiveAgentStopState, useAgentStop } from '../hooks/useAgentStop';
import { en } from '../lang/en';
import type {
  AgentHarness,
  HarnessVersionInfo,
  MachineInfo,
  AgentConfig,
  SendCommandFn,
  CodexMaxReasoningLevel,
} from '../types/machine';
import { formatHarnessLabel, getModelDisplayLabel, getMachineDisplayName } from '../types/machine';
import type { Workspace } from '../types/workspace';
import { dispatchStartAgent } from '../utils/agentStart';
import { isModelHidden, selectModel } from '../utils/modelSelection';
import { pickSetupWorkspace } from '../utils/pickSetupWorkspace';
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

// ─── Hook: useAgentControls ─────────────────────────────────────────

const CODEX_MAX_REASONING_LEVEL_OPTIONS: {
  value: CodexMaxReasoningLevel;
  label: string;
}[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
];

const CodexMaxReasoningLevelSelect = memo(function CodexMaxReasoningLevelSelect({
  value,
  disabled,
  onChange,
}: {
  value: CodexMaxReasoningLevel | undefined;
  disabled: boolean;
  onChange: (value: CodexMaxReasoningLevel) => void;
}) {
  return (
    <select
      aria-label="Max reasoning level"
      value={value ?? ''}
      onChange={(e) => {
        const next = e.target.value as CodexMaxReasoningLevel;
        if (next) onChange(next);
      }}
      disabled={disabled}
      className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {value === undefined && (
        <option value="" disabled>
          Not set
        </option>
      )}
      {CODEX_MAX_REASONING_LEVEL_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
});

// Encapsulates all state + logic for machine/harness/model selection and
// start/stop/restart actions. Used by both the shared tab content and
// any container that needs programmatic access.
//
// INITIALIZATION MODEL
// ────────────────────
// Form state is initialized ONCE when machines first become available.
// It uses the strongest available signal: running agent → current-team role
// config → team binding → most recently registered connected workspace.
// After initialization, all state changes come
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
  runningAgentConfig: AgentConfig | undefined,
  teamConfigMachineId?: string | null,
  chatroomWorkspaces?: Workspace[]
): string | null {
  if (connectedMachines.length === 0) return null;
  // Priority: running agent > existing config machine
  if (runningAgentConfig) return runningAgentConfig.machineId;
  const configMachine = connectedMachines.find((m) =>
    roleConfigs.some((c) => c.machineId === m.machineId)
  );
  if (configMachine) return configMachine.machineId;
  if (teamConfigMachineId && connectedMachines.some((m) => m.machineId === teamConfigMachineId)) {
    return teamConfigMachineId;
  }
  const candidates =
    chatroomWorkspaces?.filter(
      (ws) =>
        ws.machineId &&
        ws.workingDir?.trim() &&
        connectedMachines.some((m) => m.machineId === ws.machineId)
    ) ?? [];
  return (
    pickSetupWorkspace(
      candidates.map((ws) => ({
        machineId: ws.machineId ?? '',
        workingDir: ws.workingDir,
        registeredAt: ws.registeredAt,
      }))
    )?.machineId ?? null
  );
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

/** Wait for workspaces when they may supply the machine or its working directory. */
export function shouldDeferInitUntilWorkspacesLoad(
  machineId: string | null,
  roleConfigs: AgentConfig[]
): boolean {
  if (!machineId) return true;
  const config = roleConfigs.find((c) => c.machineId === machineId);
  return !config?.workingDir;
}

// fallow-ignore-next-line complexity
export function useAgentControls({
  role,
  chatroomId,
  connectedMachines,
  agentConfigs,
  sendCommand,
  teamConfigModel,
  teamConfigHarness,
  teamConfigMachineId,
  teamConfigMaxReasoningLevel,
  chatroomWorkspaces,
  chatroomWorkspacesLoading,
  agentRoleView,
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
  /** Codex max reasoning cap from team config — used as fallback when machine config has no cap */
  teamConfigMaxReasoningLevel?: CodexMaxReasoningLevel;
  /** Team ID for role/team-specific defaults. */
  teamId?: string;
  /** Registered workspaces for this chatroom — used to auto-detect working dir when empty */
  chatroomWorkspaces?: Workspace[];
  /** When true, init defers until workspaces load if working dir may come from the registry */
  chatroomWorkspacesLoading?: boolean;
  agentRoleView?: AgentRoleView;
  /** Setup wizard: lock machine and working directory. */
  lockedMachineId?: string;
  lockedWorkingDir?: string;
}) {
  const { requestAgentStop } = useAgentStop();
  // Snapshot teamConfigHarness at mount — used as a seeding hint during initialization only
  const initialTeamConfigHarnessRef = useRef(teamConfigHarness);
  const previousTeamIdRef = useRef(teamId);

  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedHarness, setSelectedHarness] = useState<AgentHarness | null>(null);
  // Per-harness user model choice. Keyed by AgentHarness string.
  const [userModelByHarness, setUserModelByHarness] = useState<
    Partial<Record<AgentHarness, string>>
  >({});
  const [userMaxReasoningLevelOverride, setUserMaxReasoningLevelOverride] = useState<
    CodexMaxReasoningLevel | undefined
  >(undefined);
  const [workingDir, setWorkingDir] = useState<string>('');
  const [isStarting, setIsStarting] = useState(false);
  const [isStopSubmitting, setIsStopSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rehomeConfirmOpen, setRehomeConfirmOpen] = useState(false);
  // Guards initialization — fires exactly once when machines become available
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (previousTeamIdRef.current === teamId) return;
    previousTeamIdRef.current = teamId;
    initialTeamConfigHarnessRef.current = teamConfigHarness;
    setSelectedMachineId(null);
    setSelectedHarness(null);
    setUserModelByHarness({});
    setUserMaxReasoningLevelOverride(undefined);
    setWorkingDir('');
    setIsInitialized(false);
  }, [teamId, teamConfigHarness]);

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

  const displayAgentConfig = runningAgentConfig;

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
      lockedMachineId ??
      deriveInitialMachineId(
        connectedMachines,
        roleConfigs,
        runningAgentConfig,
        teamConfigMachineId,
        chatroomWorkspaces
      );
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
    setIsInitialized(true);
  }, [
    isInitialized,
    connectedMachines,
    roleConfigs,
    runningAgentConfig,
    chatroomWorkspaces,
    chatroomWorkspacesLoading,
    lockedMachineId,
    lockedWorkingDir,
    teamConfigMachineId,
  ]);

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
  const modelFilter = useMachineModelFilter(selectedMachineId, selectedHarness);
  const machineModelFilter = modelFilter.filter ?? null;
  const machineModelFilterLoading = modelFilter.enabled && modelFilter.filter === undefined;

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

  const selectedMaxReasoningLevel = useMemo((): CodexMaxReasoningLevel | undefined => {
    if (selectedHarness !== 'codex-sdk') return undefined;
    if (userMaxReasoningLevelOverride !== undefined) {
      return userMaxReasoningLevelOverride;
    }
    const config = roleConfigs.find(
      (c) =>
        c.machineId === selectedMachineId &&
        c.agentType === selectedHarness &&
        c.maxReasoningLevel !== undefined
    );
    if (config?.maxReasoningLevel) {
      return config.maxReasoningLevel;
    }
    if (
      teamConfigMaxReasoningLevel &&
      selectedMachineId === teamConfigMachineId &&
      selectedHarness === teamConfigHarness
    ) {
      return teamConfigMaxReasoningLevel;
    }
    return undefined;
  }, [
    selectedHarness,
    userMaxReasoningLevelOverride,
    roleConfigs,
    selectedMachineId,
    teamConfigMaxReasoningLevel,
    teamConfigMachineId,
    teamConfigHarness,
  ]);

  const isAgentRunning = !!displayAgentConfig;
  const stopState = agentRoleView?.stopState ?? 'idle';
  const isStopping = isStopSubmitting || isActiveAgentStopState(stopState);
  const stopFailed = stopState === 'failed';
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
        ? buildMachineConfigScopeKey(selectedMachineId, teamId, role)
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
        await dispatchStartAgent(sendCommand, {
          machineId: selectedMachineId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          model: selectedModel || undefined,
          agentHarness: selectedHarness,
          workingDir: workingDir.trim() || undefined,
          allowNewMachine,
          ...(selectedHarness === 'codex-sdk' && selectedMaxReasoningLevel !== undefined
            ? { maxReasoningLevel: selectedMaxReasoningLevel }
            : {}),
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
      selectedMaxReasoningLevel,
      workingDir,
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
    if (!displayAgentConfig) return;
    setError(null);
    try {
      setIsStopSubmitting(true);
      await requestAgentStop({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        machineId: displayAgentConfig.machineId,
        role,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop agent');
    } finally {
      setIsStopSubmitting(false);
    }
  }, [displayAgentConfig, requestAgentStop, chatroomId, role]);

  const handleRestartAgent = useCallback(async () => {
    if (!displayAgentConfig) return;
    const model = displayAgentConfig.model ?? selectedModel;
    if (!model) {
      setError('Cannot restart agent: model is required');
      return;
    }
    setIsStarting(true);
    setError(null);
    try {
      await sendCommand({
        machineId: displayAgentConfig.machineId,
        type: 'restart-agent',
        payload: {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          model,
          agentHarness: displayAgentConfig.agentType,
          workingDir: displayAgentConfig.workingDir,
          ...(displayAgentConfig.agentType === 'codex-sdk' &&
          displayAgentConfig.maxReasoningLevel !== undefined
            ? { maxReasoningLevel: displayAgentConfig.maxReasoningLevel }
            : {}),
        },
      });
      setSuccess('Restart command sent!');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart agent');
    } finally {
      setIsStarting(false);
    }
  }, [displayAgentConfig, selectedModel, sendCommand, chatroomId, role]);

  // Wrapper for machine change — clears harness, per-harness model memory, and re-initializes for new machine
  const handleMachineChange = useCallback(
    (machineId: string | null) => {
      if (lockedMachineId) return;
      setSelectedMachineId(machineId);
      setSelectedHarness(null);
      setUserModelByHarness({});
      setUserMaxReasoningLevelOverride(undefined);
      const wd = deriveInitialWorkingDir(machineId, roleConfigs, chatroomWorkspaces);
      setWorkingDir(wd);
    },
    [roleConfigs, chatroomWorkspaces, lockedMachineId]
  );

  // Wrapper for harness change — does NOT clear other harnesses' model memory.
  const handleHarnessChange = useCallback((harness: AgentHarness | null) => {
    setSelectedHarness(harness);
    setUserMaxReasoningLevelOverride(undefined);
  }, []);

  const handleMaxReasoningLevelChange = useCallback((value: CodexMaxReasoningLevel) => {
    setUserMaxReasoningLevelOverride(value);
  }, []);

  // Wrapper for user manually selecting a model — stored per harness
  const handleModelChange = useCallback(
    (model: string | null, harnessOverride?: AgentHarness | null) => {
      const harness = harnessOverride ?? selectedHarness;
      if (!harness) return;
      if (model) {
        setUserModelByHarness((prev) => ({ ...prev, [harness]: model }));
      } else {
        setUserModelByHarness((prev) => {
          const next = { ...prev };
          delete next[harness];
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
    selectedMaxReasoningLevel,
    workingDir,
    isStarting,
    isStopping,
    stopFailed,
    stopState,
    error,
    success,
    roleConfigs,
    runningAgentConfig,
    displayAgentConfig,
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
    handleMaxReasoningLevelChange,
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

// fallow-ignore-next-line complexity
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
    selectedMaxReasoningLevel,
    workingDir,
    isStarting,
    isStopping,
    stopFailed,
    availableHarnessesForMachine,
    harnessVersionsForMachine,
    availableModelsForHarness,
    displayAgentConfig,
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
    handleMaxReasoningLevelChange,
    handleWorkingDirChange,
    rehomeConfirmOpen,
    rehomeDialogLabels,
    handleConfirmRehomeStart,
    handleCancelRehomeStart,
  } = controls;

  // When an agent is running, display values come exclusively from runningAgentConfig.
  // Internal form state is preserved so it's ready again when the agent stops.
  const runningConfig = isAgentRunning ? displayAgentConfig : undefined;
  const displayMachineId = runningConfig?.machineId ?? selectedMachineId;
  const displayHarness = runningConfig?.agentType ?? selectedHarness;
  const displayModel = runningConfig?.model ?? selectedModel;
  const displayWorkingDir = runningConfig?.workingDir ?? workingDir;
  const displayMaxReasoningLevel = isAgentRunning
    ? runningConfig?.maxReasoningLevel
    : selectedMaxReasoningLevel;
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

  const currentMachineConfigEntry = useMemo(() => {
    if (!displayHarness || !displayModel) return null;
    return { agentHarness: displayHarness, model: displayModel };
  }, [displayHarness, displayModel]);

  const currentMachineConfigIsFavorite =
    currentMachineConfigEntry != null && isFavorite(currentMachineConfigEntry);

  const handleApplyMachineConfig = useCallback(
    (entry: { agentHarness: AgentHarness; model: string }) => {
      handleHarnessChange(entry.agentHarness);
      handleModelChange(entry.model, entry.agentHarness);
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

  // Machine-level model filter for the displayed machine + harness
  const { modelFilter, isSelectedModelHidden } = useHarnessModelPicker({
    machineId: displayMachineId,
    harness: displayHarness,
    availableModels: availableModelsForHarness,
    selectedModel: displayModel,
  });

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

          {/* Row 3: Model + Max reasoning + Start/Stop */}
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              {hasModels ? (
                <div className="flex items-center gap-1 min-w-0">
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
                        <ModelPickerMeta
                          isSelectedModelHidden={isSelectedModelHidden}
                          filter={modelFilter.filter}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0">
                      <ModelPickerField
                        machineId={displayMachineId}
                        harness={displayHarness}
                        availableModels={availableModelsForHarness}
                        value={displayModel ?? ''}
                        onValueChange={(m) => handleModelChange(m || null)}
                        disabled={isBusy || !displayHarness}
                        triggerVariant="chatroom"
                        allowDeselect={false}
                        placeholder="Model..."
                        className="gap-1"
                      />
                    </div>
                  )}
                </div>
              ) : null}
              {displayHarness === 'codex-sdk' && (
                <CodexMaxReasoningLevelSelect
                  value={displayMaxReasoningLevel}
                  disabled={isBusy || isAgentRunning}
                  onChange={handleMaxReasoningLevelChange}
                />
              )}
            </div>

            {displayMachineId && displayHarness && isAgentRunning && (
              <ModelFilterButton
                filter={modelFilter}
                availableModels={availableModelsForHarness}
                disabled={isBusy}
                variant="chatroom"
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
                      aria-busy={isStopping}
                      aria-label={stopFailed ? 'Retry stopping agent' : 'Stop Agent'}
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

          <div className="min-h-4 text-[10px]" aria-live="polite">
            {controls.error ? (
              <p role="alert" className="text-chatroom-status-error">
                {controls.error}
              </p>
            ) : stopFailed ? (
              <p role="alert" className="text-chatroom-status-error">
                Stop failed. Try again.
              </p>
            ) : isStopping ? (
              <p role="status" className="text-chatroom-text-secondary">
                Stopping…
              </p>
            ) : null}
          </div>

          {displayMachineId && currentMachineConfigEntry && !currentMachineConfigIsFavorite && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void addFavorite(currentMachineConfigEntry)}
              className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-status-warning disabled:opacity-50"
            >
              <Plus size={12} />
              {en.configFavorites.addCurrentConfig}
            </button>
          )}
          {displayMachineId && currentMachineConfigEntry && currentMachineConfigIsFavorite && (
            <div className="flex items-center gap-1 text-xs text-chatroom-text-muted">
              <Star size={12} className="text-chatroom-status-warning" />
              {en.configFavorites.currentConfigFavorited}
            </div>
          )}

          {displayMachineId && (
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
            />
          )}

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
