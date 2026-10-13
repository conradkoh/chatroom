'use client';
/* eslint-disable react-hooks/exhaustive-deps -- useAgentControls syncs async Convex data and team changes into local state on purpose; the refactor is tracked as tech debt. */

import { FileText } from 'lucide-react';
import {
  useState,
  useMemo,
  memo,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

import { deriveAgentStatus, deriveRehomeLabels } from './agent-controls/derivations';
import {
  isReadyToInitialize,
  resolveInitialSelection,
  type InitializationInputs,
} from './agent-controls/initialization';
import { LoadingNotice, NoMachinesNotice, RemoteTabBody } from './agent-controls/RemoteTabParts';
import { useAgentDerivations } from './agent-controls/useAgentDerivations';
import { useAgentRunActions } from './agent-controls/useAgentRunActions';
import { useAgentSaveAction } from './agent-controls/useAgentSaveAction';
import { useModelOptions } from './agent-controls/useModelOptions';
import { useRemoteTabModel } from './agent-controls/useRemoteTabModel';
import { useSelectionHandlers } from './agent-controls/useSelectionHandlers';
import { PromptViewerModal, toTitleCase } from './AgentPanel/PromptViewerModal';
import { CopyButton } from './CopyButton';
import type { MachineConnectivity } from '../../../hooks/useDaemonConnectivity';
import { useMachineConfigFavorites } from '../features/machine-config/hooks/useMachineConfigFavorites';
import { useMachineConfigUsage } from '../features/machine-config/hooks/useMachineConfigUsage';
import {
  favoriteDefaultBlocked,
  favoriteHarnessDefault,
} from '../features/machine-config/lib/favoriteDefaults';
import { buildMachineConfigScopeKey } from '../features/machine-config/lib/machineConfigScopeKey';
import type { MachineConfigEntry } from '../features/machine-config/types/machineConfig';
import { useAgentStop } from '../hooks/useAgentStop';
import type { AgentConfig, AgentHarness, MachineInfo, SendCommandFn } from '../types/machine';
import type { Workspace } from '../types/workspace';

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
// start/stop/restart buttons. The state lives in useRemoteTabModel and the rows in
// ./agent-controls/RemoteTabParts.

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
  linkedMachineIds,
  setupMode = false,
}: RemoteTabContentProps) {
  const model = useRemoteTabModel({
    controls,
    connectedMachines,
    isLoadingMachines,
    chatroomId,
    role,
    linkedMachineIdsProp: linkedMachineIds,
  });

  return (
    <div className="space-y-2">
      {isLoadingMachines ? (
        <LoadingNotice />
      ) : model.hasNoMachines ? (
        <NoMachinesNotice daemonStartCommand={daemonStartCommand} />
      ) : (
        <RemoteTabBody
          controls={controls}
          model={model}
          connectedMachines={connectedMachines}
          isLoadingMachines={isLoadingMachines}
          setupMode={setupMode}
          daemonConnectivity={daemonConnectivity}
          chatroomId={chatroomId}
        />
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
