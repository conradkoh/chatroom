'use client';
/* eslint-disable react-hooks/exhaustive-deps -- useAgentControls syncs async Convex data and team changes into local state on purpose; the refactor is tracked as tech debt. */

import {
  Play,
  Square,
  RotateCw,
  Loader2,
  AlertCircle,
  ChevronDown,
  FileText,
  Star,
  Save,
} from 'lucide-react';
import React, {
  useState,
  useMemo,
  useCallback,
  memo,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

import {
  deriveAgentStatus,
  deriveRehomeLabels,
  favoriteDefaultBlocked,
} from './agent-controls/derivations';
import {
  deriveInitialMachineId,
  deriveInitialWorkingDir,
  shouldDeferInitUntilWorkspacesLoad,
  isReadyToInitialize,
  resolveInitialSelection,
  type InitializationInputs,
} from './agent-controls/initialization';
import { useAgentDerivations } from './agent-controls/useAgentDerivations';
import { useAgentRunActions } from './agent-controls/useAgentRunActions';
import { useAgentSaveAction } from './agent-controls/useAgentSaveAction';
import { useModelOptions } from './agent-controls/useModelOptions';
import { useSelectionHandlers } from './agent-controls/useSelectionHandlers';
import { MachineConfigQuickPick } from './AgentPanel/MachineConfigQuickPick';
import { PromptViewerModal, toTitleCase } from './AgentPanel/PromptViewerModal';
import { CopyButton } from './CopyButton';
import { MachineCapabilitiesRefreshButton } from './MachineCapabilitiesRefreshButton';
import {
  ModelFilterButton,
  ModelPickerField,
  ModelPickerMeta,
  useHarnessModelPicker,
} from './model-selection';
import {
  ResponsivePickerShell,
  PickerSearch,
  PickerScrollBody,
  PickerOptionRow,
  usePickerSearchState,
  filterPickerItems,
} from './picker';
import type { MachineConnectivity } from '../../../hooks/useDaemonConnectivity';
import { useMachineConfigFavorites } from '../features/machine-config/hooks/useMachineConfigFavorites';
import { useMachineConfigUsage } from '../features/machine-config/hooks/useMachineConfigUsage';
import { computeRecommendedMachineConfigs } from '../features/machine-config/lib/computeRecommendedMachineConfigs';
import { buildMachineConfigScopeKey } from '../features/machine-config/lib/machineConfigScopeKey';
import { favoriteHarnessDefault } from '../features/machine-config/lib/pickFavoriteDefault';
import type { MachineConfigEntry } from '../features/machine-config/types/machineConfig';
import { useAgentStop } from '../hooks/useAgentStop';
import type {
  AgentHarness,
  HarnessVersionInfo,
  MachineInfo,
  AgentConfig,
  SendCommandFn,
} from '../types/machine';
import { formatHarnessLabel, getModelDisplayLabel, getMachineDisplayName } from '../types/machine';
import type { Workspace } from '../types/workspace';
import { useChatroomWorkspaces } from '../workspace/hooks/useChatroomWorkspaces';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

// The helpers are part of this module's public surface, so tests and callers import them from here.
export { deriveInitialMachineId, deriveInitialWorkingDir, shouldDeferInitUntilWorkspacesLoad };

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
//
// The pure rules live in ./agent-controls/. This file keeps the two sync hooks, which copy async
// Convex data into local state, and composes the rest.

// ─── Sync hooks ─────────────────────────────────────────────────────

interface SelectionSyncArgs extends Omit<InitializationInputs, 'teamConfigHarness'> {
  teamId?: string;
  teamConfigHarness?: AgentHarness;
  workspaceId?: string;
  configurationLoading: boolean;
  chatroomWorkspaces?: Workspace[];
  isInitialized: boolean;
  previousTeamIdRef: RefObject<string | undefined>;
  initialTeamConfigHarnessRef: RefObject<AgentHarness | undefined>;
  harnessTouchedRef: RefObject<boolean>;
  favoriteDefaultAppliedForRef: RefObject<string | null>;
  setSelectedMachineId: Dispatch<SetStateAction<string | null>>;
  setSelectedHarness: Dispatch<SetStateAction<AgentHarness | null>>;
  setUserModelByHarness: Dispatch<SetStateAction<Partial<Record<AgentHarness, string>>>>;
  setWorkingDir: Dispatch<SetStateAction<string>>;
  setIsInitialized: Dispatch<SetStateAction<boolean>>;
}

/**
 * Resets the selection when the team changes, and initializes it once from the persisted state.
 * Both effects copy async data into local state on purpose (see the file-level directive).
 */
function useSelectionInitialization(args: SelectionSyncArgs): void {
  const {
    teamId,
    teamConfigHarness,
    workspaceId,
    configurationLoading,
    isInitialized,
    connectedMachines,
    roleConfigs,
    runningAgentConfig,
    teamConfigMachineId,
    chatroomWorkspaces,
    chatroomWorkspacesLoading,
    initializationWorkspaces,
    preferredWorkspace,
    lockedMachineId,
    lockedWorkingDir,
    previousTeamIdRef,
    initialTeamConfigHarnessRef,
    harnessTouchedRef,
    favoriteDefaultAppliedForRef,
    setSelectedMachineId,
    setSelectedHarness,
    setUserModelByHarness,
    setWorkingDir,
    setIsInitialized,
  } = args;

  useEffect(() => {
    if (previousTeamIdRef.current === teamId) return;
    previousTeamIdRef.current = teamId;
    initialTeamConfigHarnessRef.current = teamConfigHarness;
    setSelectedMachineId(null);
    setSelectedHarness(null);
    setUserModelByHarness({});
    setWorkingDir('');
    setIsInitialized(false);
    harnessTouchedRef.current = false;
    favoriteDefaultAppliedForRef.current = null;
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

  // Fires exactly once — when machines first become available.
  // The "last used" config is derived solely from the persisted launch snapshot (roleConfigs).
  useEffect(() => {
    if (
      !isReadyToInitialize({
        isInitialized,
        connectedCount: connectedMachines.length,
        workspaceId,
        configurationLoading,
      })
    )
      return;
    const init = resolveInitialSelection({
      connectedMachines,
      roleConfigs,
      runningAgentConfig,
      teamConfigMachineId,
      teamConfigHarness: initialTeamConfigHarnessRef.current,
      initializationWorkspaces,
      preferredWorkspace,
      chatroomWorkspacesLoading,
      lockedMachineId,
      lockedWorkingDir,
    });
    if (!init) return;
    // The persisted snapshot or team config already chose this machine's harness, so the
    // favourite default must not run for it.
    if (init.seededFromConfig) favoriteDefaultAppliedForRef.current = init.machineId;
    setSelectedMachineId(init.machineId);
    setSelectedHarness(init.harness);
    setWorkingDir(init.workingDir);
    setIsInitialized(true);
  }, [
    isInitialized,
    connectedMachines,
    roleConfigs,
    runningAgentConfig,
    chatroomWorkspaces,
    initializationWorkspaces,
    chatroomWorkspacesLoading,
    configurationLoading,
    workspaceId,
    lockedMachineId,
    lockedWorkingDir,
    teamConfigMachineId,
    preferredWorkspace,
  ]);
}

interface FavoriteDefaultArgs {
  isInitialized: boolean;
  selectedMachineId: string | null;
  chatroomId: string;
  teamId?: string;
  role: string;
  roleConfigs: AgentConfig[];
  runningAgentConfig: AgentConfig | undefined;
  availableHarnessesForMachine: AgentHarness[];
  harnessTouchedRef: RefObject<boolean>;
  favoriteDefaultAppliedForRef: RefObject<string | null>;
  setSelectedHarness: Dispatch<SetStateAction<AgentHarness | null>>;
}

/**
 * Favourite-based default harness. Runs once per machine, after initialization. The machine's
 * favourites (same scope as RemoteTabContent, so the query is shared) pick the top usable harness.
 * Persisted snapshots, running agents, seeded team config and explicit user choices always win.
 * Returns the favourites so the model options can use them.
 */
function useFavoriteHarnessDefault(args: FavoriteDefaultArgs): readonly MachineConfigEntry[] {
  const {
    isInitialized,
    selectedMachineId,
    chatroomId,
    teamId,
    role,
    roleConfigs,
    runningAgentConfig,
    availableHarnessesForMachine,
    harnessTouchedRef,
    favoriteDefaultAppliedForRef,
    setSelectedHarness,
  } = args;

  const defaultsFavoriteScope = useMemo(
    () =>
      selectedMachineId && teamId
        ? { machineId: selectedMachineId, chatroomId, teamId, role }
        : undefined,
    [selectedMachineId, chatroomId, teamId, role]
  );
  const { favorites: defaultFavorites, isLoading: defaultFavoritesLoading } =
    useMachineConfigFavorites(defaultsFavoriteScope);

  // Ready once the machine is initialized and its favourites have loaded. Until then the default
  // is not decided, so a late load can still apply it.
  const favoriteDefaultReady =
    isInitialized && !!selectedMachineId && !!defaultsFavoriteScope && !defaultFavoritesLoading;

  useEffect(() => {
    if (!favoriteDefaultReady || favoriteDefaultAppliedForRef.current === selectedMachineId) return;
    favoriteDefaultAppliedForRef.current = selectedMachineId;
    const hasSnapshot = roleConfigs.some((c) => c.machineId === selectedMachineId);
    const harness = favoriteHarnessDefault({
      favorites: defaultFavorites,
      availableHarnesses: availableHarnessesForMachine,
      blocked: favoriteDefaultBlocked(harnessTouchedRef.current, runningAgentConfig, hasSnapshot),
    });
    if (harness) setSelectedHarness(harness);
  }, [
    favoriteDefaultReady,
    selectedMachineId,
    defaultFavorites,
    availableHarnessesForMachine,
    roleConfigs,
    runningAgentConfig,
  ]);

  return defaultFavorites;
}

// ─── Composition ────────────────────────────────────────────────────

export function useAgentControls({
  role,
  chatroomId,
  workspaceId,
  connectedMachines,
  agentConfigs,
  sendCommand,
  teamConfigModel,
  teamConfigHarness,
  teamConfigMachineId,
  configurationLoading = false,
  chatroomWorkspaces,
  chatroomWorkspacesLoading,
  runtimeIsRunning = false,
  lockedMachineId,
  lockedWorkingDir,
  teamId,
}: {
  role: string;
  chatroomId: string;
  workspaceId?: string;
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
  /** The selected workspace's last configuration is still loading. */
  configurationLoading?: boolean;
  /** Team ID for role/team-specific defaults. */
  teamId?: string;
  /** Registered workspaces for this chatroom — used to auto-detect working dir when empty */
  chatroomWorkspaces?: Workspace[];
  /** When true, init defers until workspaces load if working dir may come from the registry */
  chatroomWorkspacesLoading?: boolean;
  /** Running state from the daemon-fed status projection. */
  runtimeIsRunning?: boolean;
  /** Setup wizard: lock machine and working directory. */
  lockedMachineId?: string;
  lockedWorkingDir?: string;
}) {
  const { requestAgentStop } = useAgentStop();
  // Snapshot teamConfigHarness at mount — used as a seeding hint during initialization only
  const initialTeamConfigHarnessRef = useRef(teamConfigHarness);
  const previousTeamIdRef = useRef(teamId);
  // Favourite-based default (one-shot per machine). harnessTouchedRef blocks it after any explicit
  // harness or model choice. favoriteDefaultAppliedForRef records the machine it was decided for.
  const harnessTouchedRef = useRef(false);
  const favoriteDefaultAppliedForRef = useRef<string | null>(null);

  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedHarness, setSelectedHarness] = useState<AgentHarness | null>(null);
  // Per-harness user model choice. Keyed by AgentHarness string.
  const [userModelByHarness, setUserModelByHarness] = useState<
    Partial<Record<AgentHarness, string>>
  >({});
  const [workingDir, setWorkingDir] = useState<string>('');
  const [isStarting, setIsStarting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isStopSubmitting, setIsStopSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rehomeConfirmOpen, setRehomeConfirmOpen] = useState(false);
  // Guards initialization — fires exactly once when machines become available
  const [isInitialized, setIsInitialized] = useState(false);

  const {
    roleConfigs,
    preferredWorkspace,
    initializationWorkspaces,
    runningAgentConfig,
    displayAgentConfig,
    availableHarnessesForMachine,
    harnessVersionsForMachine,
  } = useAgentDerivations({
    role,
    agentConfigs,
    workspaceId,
    chatroomWorkspaces,
    connectedMachines,
    runtimeIsRunning,
    selectedMachineId,
  });

  useSelectionInitialization({
    teamId,
    teamConfigHarness,
    workspaceId,
    configurationLoading,
    connectedMachines,
    roleConfigs,
    runningAgentConfig,
    teamConfigMachineId,
    chatroomWorkspaces,
    chatroomWorkspacesLoading,
    initializationWorkspaces,
    preferredWorkspace,
    lockedMachineId,
    lockedWorkingDir,
    isInitialized,
    previousTeamIdRef,
    initialTeamConfigHarnessRef,
    harnessTouchedRef,
    favoriteDefaultAppliedForRef,
    setSelectedMachineId,
    setSelectedHarness,
    setUserModelByHarness,
    setWorkingDir,
    setIsInitialized,
  });

  const defaultFavorites = useFavoriteHarnessDefault({
    isInitialized,
    selectedMachineId,
    chatroomId,
    teamId,
    role,
    roleConfigs,
    runningAgentConfig,
    availableHarnessesForMachine,
    harnessTouchedRef,
    favoriteDefaultAppliedForRef,
    setSelectedHarness,
  });

  const { availableModelsForHarness, visibleModels, machineModelFilter, selectedModel } =
    useModelOptions({
      selectedMachineId,
      selectedHarness,
      roleConfigs,
      teamConfigModel,
      userModelByHarness,
      defaultFavorites,
    });

  const isAgentRunning = !!displayAgentConfig;
  const hasModels = availableModelsForHarness.length > 0;
  const status = deriveAgentStatus({
    selectedMachineId,
    selectedHarness,
    selectedModel,
    hasModels,
    workingDir,
    workspaceId,
    isStarting,
    isSaving,
    isStopSubmitting,
    isAgentRunning,
    success,
  });

  const rehomeDialogLabels = useMemo(
    () => deriveRehomeLabels(teamConfigMachineId, selectedMachineId, connectedMachines),
    [teamConfigMachineId, selectedMachineId, connectedMachines]
  );

  const machineConfigScopeKeyForControls = useMemo(
    () =>
      selectedMachineId && teamId
        ? buildMachineConfigScopeKey(selectedMachineId, teamId, role)
        : undefined,
    [selectedMachineId, teamId, role]
  );
  const { recordUsage: recordMachineConfigUsage } = useMachineConfigUsage(
    machineConfigScopeKeyForControls
  );

  const runActions = useAgentRunActions({
    chatroomId,
    workspaceId,
    role,
    selectedMachineId,
    selectedHarness,
    selectedModel,
    workingDir,
    displayAgentConfig,
    teamConfigMachineId,
    sendCommand,
    requestAgentStop,
    recordMachineConfigUsage,
    setIsStarting,
    setError,
    setSuccess,
    setIsStopSubmitting,
    setRehomeConfirmOpen,
  });

  const handleSaveConfig = useAgentSaveAction({
    chatroomId,
    workspaceId,
    role,
    selectedMachineId,
    selectedHarness,
    selectedModel,
    workingDir,
    canSave: status.canSave,
    setIsSaving,
    setError,
    setSuccess,
  });

  const selectionHandlers = useSelectionHandlers({
    lockedMachineId,
    lockedWorkingDir,
    roleConfigs,
    chatroomWorkspaces,
    selectedHarness,
    harnessTouchedRef,
    favoriteDefaultAppliedForRef,
    setSelectedMachineId,
    setSelectedHarness,
    setUserModelByHarness,
    setWorkingDir,
  });

  return {
    workspaceId,
    selectedMachineId,
    selectedHarness,
    selectedModel,
    workingDir,
    isStarting,
    isSaving,
    isStopping: status.isStopping,
    stopFailed: false,
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
    isBusy: status.isBusy,
    hasModels,
    canStart: status.canStart,
    canSave: status.canSave,
    canStop: status.canStop,
    canRestart: status.canRestart,
    handleStartAgent: runActions.handleStartAgent,
    handleSaveConfig,
    handleStopAgent: runActions.handleStopAgent,
    handleRestartAgent: runActions.handleRestartAgent,
    handleMachineChange: selectionHandlers.handleMachineChange,
    handleHarnessChange: selectionHandlers.handleHarnessChange,
    handleModelChange: selectionHandlers.handleModelChange,
    handleWorkingDirChange: selectionHandlers.handleWorkingDirChange,
    rehomeConfirmOpen,
    rehomeDialogLabels,
    handleConfirmRehomeStart: runActions.handleConfirmRehomeStart,
    handleCancelRehomeStart: runActions.handleCancelRehomeStart,
    teamId,
  };
}

// ─── Component: RemoteTabContent ────────────────────────────────────
// The "Remote" tab UI: machine selection, harness, model, working dir,
// start/stop/restart buttons.

interface RemoteTabContentProps {
  controls: ReturnType<typeof useAgentControls>;
  connectedMachines: MachineInfo[];
  daemonConnectivity?: Map<string, MachineConnectivity>;
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
  daemonConnectivity,
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
    isSaving,
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
    canSave,
    canStop,
    canRestart,
    handleStartAgent,
    handleSaveConfig,
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
  } = controls;

  // When an agent is running, display values come exclusively from runningAgentConfig.
  // Internal form state is preserved so it's ready again when the agent stops.
  const runningConfig = isAgentRunning ? displayAgentConfig : undefined;
  const displayMachineId = runningConfig?.machineId ?? selectedMachineId;
  const displayHarness = runningConfig?.agentType ?? selectedHarness;
  const displayModel = runningConfig?.model ?? selectedModel;
  const displayWorkingDir = runningConfig?.workingDir ?? workingDir;
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
  const modelUnavailable = !displayMachineId || !displayHarness || !hasModels;

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
              No machines registered. Run:
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
                  daemonConnected={daemonConnectivity?.get(displayMachineId)?.connected === true}
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
            <div className="flex items-center gap-1 flex-1 min-w-0">
              {isAgentRunning ? (
                <div className="flex-1 min-w-0">
                  <div
                    className={cn(
                      'w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 opacity-50 flex items-center justify-between',
                      !modelUnavailable && isSelectedModelHidden && 'text-chatroom-status-warning'
                    )}
                  >
                    <span className="truncate">
                      {modelUnavailable
                        ? 'No models available'
                        : displayModel
                          ? getModelDisplayLabel(displayModel)
                          : 'Model...'}
                    </span>
                    {!modelUnavailable && (
                      <ModelPickerMeta
                        isSelectedModelHidden={isSelectedModelHidden}
                        filter={modelFilter.filter}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-w-0">
                  <ModelPickerField
                    machineId={displayMachineId}
                    harness={displayHarness}
                    availableModels={availableModelsForHarness}
                    value={modelUnavailable ? '' : (displayModel ?? '')}
                    onValueChange={(m) => handleModelChange(m || null)}
                    disabled={isBusy || modelUnavailable}
                    triggerVariant="chatroom"
                    allowDeselect={false}
                    placeholder="Model..."
                    className="gap-1"
                  />
                </div>
              )}
            </div>

            {displayMachineId && currentMachineConfigEntry && (
              <button
                type="button"
                disabled={isBusy}
                onClick={(event) => {
                  event.stopPropagation();
                  if (currentMachineConfigIsFavorite) {
                    void removeFavorite(currentMachineConfigEntry);
                  } else {
                    void addFavorite(currentMachineConfigEntry);
                  }
                }}
                aria-label={
                  currentMachineConfigIsFavorite
                    ? 'Remove current config from favorites'
                    : 'Add current config to favorites'
                }
                title={
                  currentMachineConfigIsFavorite
                    ? 'Remove current config from favorites'
                    : 'Add current config to favorites'
                }
                className="shrink-0 h-7 w-7 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-status-warning focus-visible:outline focus-visible:outline-2 focus-visible:outline-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Star
                  size={14}
                  className={
                    currentMachineConfigIsFavorite
                      ? 'fill-chatroom-status-warning text-chatroom-status-warning'
                      : ''
                  }
                />
              </button>
            )}

            {displayMachineId && displayHarness && (
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
                {!isAgentRunning && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleSaveConfig();
                    }}
                    disabled={!canSave}
                    aria-label="Save Configuration"
                    className={`w-7 h-7 flex items-center justify-center transition-all ${
                      canSave
                        ? 'text-chatroom-status-info hover:bg-chatroom-status-info/10'
                        : 'text-chatroom-text-muted cursor-not-allowed opacity-50'
                    }`}
                    title="Save configuration"
                  >
                    {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  </button>
                )}
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
                      aria-label="Restart Agent"
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
                    aria-label="Start Agent"
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

          <div className="text-[10px]" aria-live="polite">
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
