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
  CheckCircle,
  SlidersHorizontal,
  FileText,
} from 'lucide-react';
import React, { useState, useMemo, useCallback, memo, useEffect, useRef } from 'react';


import { CopyButton } from './CopyButton';
import { PromptViewerModal, toTitleCase } from './AgentPanel/PromptViewerModal';
import { ModelFilterPanel } from './ModelFilterPanel';
import type {
  AgentHarness,
  HarnessVersionInfo,
  MachineInfo,
  AgentConfig,
  SendCommandFn,
} from '../types/machine';
import { HARNESS_DISPLAY_NAMES, getModelDisplayLabel } from '../types/machine';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────

export interface AgentConfigTabsProps {
  role: string;
  prompt: string;
  chatroomId: string;
  connectedMachines: MachineInfo[];
  agentConfigs: AgentConfig[];
  isLoadingMachines: boolean;
  daemonStartCommand: string;
  sendCommand: SendCommandFn;
  onViewPrompt?: (role: string) => void;
}

/** User's saved preference for a single role's remote agent config. */
export interface AgentPreference {
  role: string;
  machineId: string;
  agentHarness: AgentHarness;
  model?: string;
  workingDir?: string;
}

// ─── Hook: useAgentControls ─────────────────────────────────────────
// Encapsulates all state + logic for machine/harness/model selection and
// start/stop/restart actions. Used by both the shared tab content and
// any container that needs programmatic access.
//
// INITIALIZATION MODEL
// ────────────────────
// Form state is initialized ONCE when machines first become available,
// using a snapshot of the agentPreference taken at mount time.
// After initialization, all state changes come exclusively from explicit
// user interactions (handleMachineChange, handleHarnessChange, etc.) — never
// from reactive prop updates.
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

function deriveInitialMachine(
  connectedMachines: MachineInfo[],
  roleConfigs: AgentConfig[],
  runningAgentConfig: AgentConfig | undefined,
  preference: AgentPreference | undefined
): string | null {
  if (connectedMachines.length === 0) return null;
  // Priority: running agent > existing config machine > saved preference > first available
  if (runningAgentConfig) return runningAgentConfig.machineId;
  const configMachine = connectedMachines.find((m) =>
    roleConfigs.some((c) => c.machineId === m.machineId)
  );
  if (configMachine) return configMachine.machineId;
  if (preference && connectedMachines.some((m) => m.machineId === preference.machineId)) {
    return preference.machineId;
  }
  return connectedMachines[0]?.machineId ?? null;
}

function deriveInitialHarness(
  machineId: string | null,
  connectedMachines: MachineInfo[],
  roleConfigs: AgentConfig[],
  preference: AgentPreference | undefined,
  teamConfigHarness?: AgentHarness
): AgentHarness | null {
  if (!machineId) return null;
  const machine = connectedMachines.find((m) => m.machineId === machineId);
  const available = machine?.availableHarnesses ?? [];
  // Priority: existing config harness > team config harness > saved preference > only option
  const config = roleConfigs.find((c) => c.machineId === machineId);
  if (config && available.includes(config.agentType)) return config.agentType;
  if (teamConfigHarness && available.includes(teamConfigHarness)) return teamConfigHarness;
  if (
    preference &&
    preference.machineId === machineId &&
    available.includes(preference.agentHarness)
  ) {
    return preference.agentHarness;
  }
  if (available.length === 1) return available[0];
  return null;
}

function deriveInitialWorkingDir(
  machineId: string | null,
  roleConfigs: AgentConfig[],
  preference: AgentPreference | undefined
): string {
  if (machineId) {
    const config = roleConfigs.find((c) => c.machineId === machineId);
    if (config?.workingDir) return config.workingDir;
    if (preference && preference.machineId === machineId && preference.workingDir) {
      return preference.workingDir;
    }
  }
  if (roleConfigs.length > 0) {
    const latest = roleConfigs.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    if (latest.workingDir) return latest.workingDir;
  }
  return preference?.workingDir ?? '';
}

export function useAgentControls({
  role,
  chatroomId,
  connectedMachines,
  agentConfigs,
  sendCommand,
  teamConfigModel,
  teamConfigHarness,
  agentPreference,
  onSavePreference,
}: {
  role: string;
  chatroomId: string;
  connectedMachines: MachineInfo[];
  agentConfigs: AgentConfig[];
  sendCommand: AgentConfigTabsProps['sendCommand'];
  /** Model from team config — used as fallback when machine config has no model */
  teamConfigModel?: string;
  /** Harness from team config — used as a seeding hint for initialization when
   *  no roleConfig or matching preference is found */
  teamConfigHarness?: AgentHarness;
  /** User's saved preference for this role — used as default pre-population */
  agentPreference?: AgentPreference;
  /** Called when user starts an agent — saves preference for future sessions */
  onSavePreference?: (pref: AgentPreference) => void;
}) {
  // Snapshot the preference at mount — never react to preference updates
  const initialPreferenceRef = useRef(agentPreference);
  // Snapshot teamConfigHarness at mount — used as a seeding hint during initialization only
  const initialTeamConfigHarnessRef = useRef(teamConfigHarness);

  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedHarness, setSelectedHarness] = useState<AgentHarness | null>(null);
  // Per-harness user model choice. Keyed by AgentHarness string.
  const [userModelByHarness, setUserModelByHarness] = useState<
    Partial<Record<AgentHarness, string>>
  >({});
  const [workingDir, setWorkingDir] = useState<string>('');
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Guards initialization — fires exactly once when machines become available
  const [isInitialized, setIsInitialized] = useState(false);

  // Update the ref if it's still unset and teamConfigHarness arrives before initialization.
  // Safe to do in render: runs only before initialization, is a one-way undefined→defined
  // transition, and setting a ref does not trigger re-renders.
  if (!isInitialized && initialTeamConfigHarnessRef.current === undefined && teamConfigHarness !== undefined) {
    initialTeamConfigHarnessRef.current = teamConfigHarness;
  }

  // Get configs for this role
  const roleConfigs = useMemo(() => {
    return agentConfigs.filter((c) => c.role.toLowerCase() === role.toLowerCase());
  }, [agentConfigs, role]);

  // Check if there's a running agent
  const runningAgentConfig = useMemo(() => {
    return roleConfigs.find((c) => c.spawnedAgentPid && c.daemonConnected);
  }, [roleConfigs]);

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
  // Uses initialPreferenceRef.current (snapshotted at mount) so this
  // never re-runs due to preference updates from Convex.
  useEffect(() => {
    if (isInitialized || connectedMachines.length === 0) return;

    const pref = initialPreferenceRef.current;
    const machine = deriveInitialMachine(connectedMachines, roleConfigs, runningAgentConfig, pref);
    const harness = deriveInitialHarness(machine, connectedMachines, roleConfigs, pref, initialTeamConfigHarnessRef.current);
    const wd = deriveInitialWorkingDir(machine, roleConfigs, pref);

    setSelectedMachineId(machine);
    setSelectedHarness(harness);
    setWorkingDir(wd);
    setIsInitialized(true);
  }, [isInitialized, connectedMachines, roleConfigs, runningAgentConfig]);

  // Available models from the selected machine filtered by selected harness
  const availableModelsForHarness = useMemo(() => {
    if (!selectedMachineId || !selectedHarness) return [];
    const machine = connectedMachines.find((m) => m.machineId === selectedMachineId);
    return machine?.availableModels[selectedHarness] ?? [];
  }, [selectedMachineId, selectedHarness, connectedMachines]);

  // ── Derived model selection ──────────────────────────────────────
  // selectedModel is a pure derivation — no useEffect, no setState.
  // Because it's computed synchronously in useMemo, switching harness
  // is guaranteed to show a model from the NEW harness in the same render.
  //
  // Priority within a harness:
  //   1. User's explicit per-harness choice (userModelByHarness), if still valid
  //   2. Saved machine config model for the same harness (agentType must match)
  //   3. Team config model
  //   4. Saved user preference model (from mount-time snapshot)
  //   5. First available model for this harness
  const selectedModel = useMemo((): string | null => {
    if (!selectedHarness || availableModelsForHarness.length === 0) {
      return null;
    }

    // 1. Per-harness user choice (if still valid in current model list)
    const userChoice = userModelByHarness[selectedHarness];
    if (userChoice && availableModelsForHarness.includes(userChoice)) {
      return userChoice;
    }

    // 2. Machine config model — only if it's saved under the same harness type
    const config = roleConfigs.find(
      (c) => c.machineId === selectedMachineId && c.agentType === selectedHarness && c.model
    );
    if (config?.model && availableModelsForHarness.includes(config.model)) {
      return config.model;
    }

    // 3. Team config model
    if (teamConfigModel && availableModelsForHarness.includes(teamConfigModel)) {
      return teamConfigModel;
    }

    // 4. Saved user preference model (from mount-time snapshot — not reactive)
    const pref = initialPreferenceRef.current;
    if (
      pref &&
      pref.machineId === selectedMachineId &&
      pref.agentHarness === selectedHarness &&
      pref.model &&
      availableModelsForHarness.includes(pref.model)
    ) {
      return pref.model;
    }

    // 5. First available for this harness
    return availableModelsForHarness[0];
  }, [
    selectedHarness,
    availableModelsForHarness,
    userModelByHarness,
    roleConfigs,
    selectedMachineId,
    teamConfigModel,
  ]);

  const isAgentRunning = !!runningAgentConfig;
  const isBusy = isStarting || isStopping;
  const hasModels = availableModelsForHarness.length > 0;
  const canStart =
    selectedMachineId &&
    selectedHarness &&
    (!hasModels || selectedModel) &&
    workingDir.trim() &&
    !isStarting &&
    !isAgentRunning &&
    !success;
  const canStop = isAgentRunning && !isStopping && !success;
  const canRestart = isAgentRunning && !isStopping && !isStarting && !success;

  const handleStartAgent = useCallback(async () => {
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
        },
      });
      // Save user preference so the Remote tab pre-populates these values next time
      onSavePreference?.({
        role,
        machineId: selectedMachineId,
        agentHarness: selectedHarness,
        model: selectedModel || undefined,
        workingDir: workingDir.trim() || undefined,
      });
      setSuccess('Start command sent!');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start agent');
    } finally {
      setIsStarting(false);
    }
  }, [
    selectedMachineId,
    selectedHarness,
    selectedModel,
    workingDir,
    sendCommand,
    chatroomId,
    role,
    onSavePreference,
  ]);

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
    setIsStopping(true);
    setError(null);
    try {
      await sendCommand({
        machineId: runningAgentConfig.machineId,
        type: 'stop-agent',
        payload: { chatroomId: chatroomId as Id<'chatroom_rooms'>, role },
      });
      await new Promise((resolve) => setTimeout(resolve, 3000));
      setIsStopping(false);
      setIsStarting(true);
      await sendCommand({
        machineId: runningAgentConfig.machineId,
        type: 'start-agent',
        payload: {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          model: selectedModel || undefined,
          agentHarness: runningAgentConfig.agentType,
          workingDir: runningAgentConfig.workingDir,
        },
      });
      setSuccess('Restart command sent!');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart agent');
    } finally {
      setIsStarting(false);
      setIsStopping(false);
    }
  }, [runningAgentConfig, selectedModel, sendCommand, chatroomId, role]);

  // Wrapper for machine change — clears harness, per-harness model memory, and re-initializes for new machine
  const handleMachineChange = useCallback(
    (machineId: string | null) => {
      setSelectedMachineId(machineId);
      setSelectedHarness(null);
      setUserModelByHarness({});
      // Re-initialize working dir for the new machine from current roleConfigs
      const pref = initialPreferenceRef.current;
      const wd = deriveInitialWorkingDir(machineId, roleConfigs, pref);
      setWorkingDir(wd);
    },
    [roleConfigs]
  );

  // Wrapper for harness change — does NOT clear other harnesses' model memory.
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
  const handleWorkingDirChange = useCallback((dir: string) => {
    setWorkingDir(dir);
  }, []);

  return {
    selectedMachineId,
    setSelectedMachineId,
    selectedHarness,
    setSelectedHarness,
    selectedModel,
    workingDir,
    setWorkingDir,
    isStarting,
    isStopping,
    error,
    success,
    roleConfigs,
    runningAgentConfig,
    availableHarnessesForMachine,
    harnessVersionsForMachine,
    availableModelsForHarness,
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
  };
}

// ─── Model Filter Helper ─────────────────────────────────────────────

/**
 * Returns true if the given model should be hidden based on the machine-level filter.
 * Checks both exact model IDs and provider prefixes (the part before the first '/').
 */
function isModelHidden(
  modelId: string,
  filter: { hiddenModels: string[]; hiddenProviders: string[] } | null | undefined
): boolean {
  if (!filter) return false;
  const provider = modelId.split('/')[0];
  const providerHidden = filter.hiddenProviders.includes(provider);
  const hasExplicitOverride = filter.hiddenModels.includes(modelId);

  if (providerHidden) {
    // Provider is hidden; hiddenModels contains exceptions (models to UN-hide)
    return !hasExplicitOverride;
  } 
    // Provider is visible; hiddenModels contains models to hide
    return hasExplicitOverride;
  
}

// ─── Component: RemoteTabContent ────────────────────────────────────
// The "Remote" tab UI: machine selection, harness, model, working dir,
// start/stop/restart buttons.

interface RemoteTabContentProps {
  controls: ReturnType<typeof useAgentControls>;
  connectedMachines: MachineInfo[];
  isLoadingMachines: boolean;
  daemonStartCommand: string;
}

export const RemoteTabContent = memo(function RemoteTabContent({
  controls,
  connectedMachines,
  isLoadingMachines,
  daemonStartCommand,
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
  } = controls;

  // When an agent is running, display values come exclusively from runningAgentConfig.
  // Internal form state is preserved so it's ready again when the agent stops.
  const displayMachineId = isAgentRunning ? runningAgentConfig!.machineId : selectedMachineId;
  const displayHarness = isAgentRunning ? runningAgentConfig!.agentType : selectedHarness;
  const displayModel = isAgentRunning ? (runningAgentConfig!.model ?? null) : selectedModel;
  const displayWorkingDir = isAgentRunning ? (runningAgentConfig!.workingDir ?? '') : workingDir;

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

  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [machinePopoverOpen, setMachinePopoverOpen] = useState(false);
  const [harnessPopoverOpen, setHarnessPopoverOpen] = useState(false);

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
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Popover open={machinePopoverOpen} onOpenChange={setMachinePopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    disabled={isBusy || isAgentRunning}
                    className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 h-auto hover:border-chatroom-border-strong focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
                    title="Select Machine"
                  >
                    <span className="truncate">
                      {displayMachineId
                        ? (connectedMachines.find((m) => m.machineId === displayMachineId)
                            ?.hostname ?? displayMachineId)
                        : 'Machine...'}
                    </span>
                    <ChevronDown size={10} className="ml-1 flex-shrink-0 text-chatroom-text-muted" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="bg-chatroom-bg-tertiary border border-chatroom-border p-0 rounded-none"
                  style={{ width: 'var(--radix-popover-trigger-width)' }}
                >
                  <Command className="bg-chatroom-bg-tertiary rounded-none">
                    <CommandList>
                      <CommandGroup>
                        {connectedMachines.map((machine) => (
                          <CommandItem
                            key={machine.machineId}
                            value={machine.hostname}
                            onSelect={() => {
                              handleMachineChange(machine.machineId);
                              setMachinePopoverOpen(false);
                            }}
                            className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover cursor-pointer flex items-center justify-between rounded-none"
                          >
                            <span className="truncate">{machine.hostname}</span>
                            {displayMachineId === machine.machineId && (
                              <span className="ml-2 flex-shrink-0 text-chatroom-accent">✓</span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex-1 min-w-0">
              <Popover open={harnessPopoverOpen} onOpenChange={setHarnessPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    disabled={
                      isBusy ||
                      isAgentRunning ||
                      !displayMachineId ||
                      availableHarnessesForMachine.length === 0
                    }
                    className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 h-auto hover:border-chatroom-border-strong focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
                    title="Select Harness"
                  >
                    <span className="truncate">
                      {displayHarness
                        ? (() => {
                            const ver = displayHarnessVersionsForMachine[displayHarness];
                            return `${HARNESS_DISPLAY_NAMES[displayHarness]}${ver ? ` v${ver.version}` : ''}`;
                          })()
                        : 'Harness...'}
                    </span>
                    <ChevronDown size={10} className="ml-1 flex-shrink-0 text-chatroom-text-muted" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="bg-chatroom-bg-tertiary border border-chatroom-border p-0 rounded-none"
                  style={{ width: 'var(--radix-popover-trigger-width)' }}
                >
                  <Command className="bg-chatroom-bg-tertiary rounded-none">
                    <CommandList>
                      <CommandGroup>
                        {availableHarnessesForMachine.map((harness) => {
                          const ver = harnessVersionsForMachine[harness];
                          const label = `${HARNESS_DISPLAY_NAMES[harness]}${ver ? ` v${ver.version}` : ''}`;
                          return (
                            <CommandItem
                              key={harness}
                              value={label}
                              onSelect={() => {
                                handleHarnessChange(harness);
                                setHarnessPopoverOpen(false);
                              }}
                              className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover cursor-pointer flex items-center justify-between rounded-none"
                            >
                              <span className="truncate">{label}</span>
                              {displayHarness === harness && (
                                <span className="ml-2 flex-shrink-0 text-chatroom-accent">✓</span>
                              )}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Row 2: Working Directory */}
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

          {/* Row 3: Model + Start/Stop */}
          <div className="flex items-center gap-2">
            {hasModels ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                {/* Model Combobox */}
                <div className="flex-1 min-w-0">
                  <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button
                        disabled={isBusy || isAgentRunning || !displayHarness}
                        className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 h-auto hover:border-chatroom-border-strong focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
                        title="Select Model"
                      >
                        <span className={cn('truncate', isSelectedModelHidden && 'text-chatroom-status-warning')}>
                          {displayModel ? getModelDisplayLabel(displayModel) : 'Model...'}
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {/* Warning: selected model is filtered out */}
                          {isSelectedModelHidden && (
                            <AlertCircle
                              size={10}
                              className="text-chatroom-status-warning flex-shrink-0"
                              aria-label="Selected model is hidden by filter — choose a new model"
                            />
                          )}
                          {/* Active filter indicator */}
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
                    </PopoverTrigger>
                    <PopoverContent className="bg-chatroom-bg-tertiary border border-chatroom-border p-0 w-[420px] rounded-none">
                      <Command className="bg-chatroom-bg-tertiary rounded-none">
                        <CommandInput
                          placeholder="Search..."
                          className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary bg-chatroom-bg-tertiary border-b border-chatroom-border focus:ring-0 focus:outline-none h-8"
                        />
                        <CommandList className="max-h-60 overflow-y-auto">
                          <CommandEmpty className="text-[10px] text-chatroom-text-muted uppercase tracking-wider py-2 text-center">
                            No models found.
                          </CommandEmpty>
                          <CommandGroup>
                            {visibleModels.map((model) => (
                              <CommandItem
                                key={model}
                                value={getModelDisplayLabel(model)}
                                onSelect={() => {
                                  handleModelChange(model);
                                  setModelPopoverOpen(false);
                                }}
                                className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover cursor-pointer flex items-center justify-between rounded-none"
                              >
                                <span className="truncate">{getModelDisplayLabel(model)}</span>
                                {displayModel === model && (
                                  <span className="ml-2 flex-shrink-0 text-chatroom-accent">✓</span>
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Filter Icon */}
                {displayMachineId && displayHarness && (
                  <ModelFilterPanel
                    open={filterPanelOpen}
                    onOpenChange={setFilterPanelOpen}
                    trigger={
                      <button
                        type="button"
                        disabled={isBusy || isAgentRunning}
                        className="w-7 h-7 flex items-center justify-center bg-chatroom-bg-tertiary border border-chatroom-border text-chatroom-text-muted hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                        title="Filter models"
                      >
                        <SlidersHorizontal size={10} />
                      </button>
                    }
                    availableModels={availableModelsForHarness}
                    filter={machineModelFilter}
                    onFilterChange={handleFilterChange}
                    disabled={isBusy || isAgentRunning}
                  />
                )}
              </div>
            ) : (
              <div className="flex-1" />
            )}

            {/* Action Buttons */}
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
                  {isStarting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                </button>
              )}
            </div>
          </div>
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
  onViewPrompt?: (role: string) => void;
}

export const CustomTabContent = memo(function CustomTabContent({
  role,
  prompt,
}: CustomTabContentProps) {
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <>
      {/* Single prompt row */}
      <button
        type="button"
        className="w-full flex items-center gap-2 text-left hover:bg-chatroom-bg-hover transition-colors px-2 py-2 -mx-2"
        onClick={() => setViewerOpen(true)}
      >
        <FileText size={14} className="text-chatroom-text-muted flex-shrink-0" />
        <span className="flex-1 text-[12px] font-medium text-chatroom-text-secondary">
          {toTitleCase(role)} Prompt
        </span>
        <div onClick={(e) => e.stopPropagation()}>
          <CopyButton text={prompt} label="Copy" copiedLabel="Copied!" variant="compact" />
        </div>
      </button>

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

// ─── Component: AgentStatusBanner ───────────────────────────────────
// Shows running agent info + success/error messages.

interface AgentStatusBannerProps {
  controls: ReturnType<typeof useAgentControls>;
}

export const AgentStatusBanner = memo(function AgentStatusBanner({
  controls,
}: AgentStatusBannerProps) {
  const { runningAgentConfig, success, error } = controls;

  return (
    <>
      {runningAgentConfig && (
        <div className="p-3 bg-chatroom-bg-tertiary border-2 border-chatroom-status-info/30">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-chatroom-status-info animate-pulse flex-shrink-0" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary">
              Agent Running
            </span>
            <span className="text-[10px] font-mono text-chatroom-text-muted">
              PID {runningAgentConfig.spawnedAgentPid}
            </span>
          </div>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-2 bg-chatroom-status-success/10 border-2 border-chatroom-status-success/30">
          <CheckCircle size={12} className="text-chatroom-status-success flex-shrink-0" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-success">
            {success}
          </p>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-2 bg-chatroom-status-error/10 border-2 border-chatroom-status-error/30">
          <AlertCircle size={12} className="text-chatroom-status-error flex-shrink-0" />
          <p className="text-[10px] font-bold text-chatroom-status-error">{error}</p>
        </div>
      )}
    </>
  );
});

// ─── Component: AgentConfigTabs ─────────────────────────────────────
// Shared tab switcher + tab content for Remote/Custom modes.
// This is the single source of truth for the tabbed agent configuration UI.

interface AgentConfigTabsComponentProps {
  activeTab: 'remote' | 'custom';
  onTabChange: (tab: 'remote' | 'custom') => void;
  controls: ReturnType<typeof useAgentControls>;
  role: string;
  prompt: string;
  connectedMachines: MachineInfo[];
  isLoadingMachines: boolean;
  daemonStartCommand: string;
  onViewPrompt?: (role: string) => void;
}

export const AgentConfigTabs = memo(function AgentConfigTabs({
  activeTab,
  onTabChange,
  controls,
  role,
  prompt,
  connectedMachines,
  isLoadingMachines,
  daemonStartCommand,
  onViewPrompt,
}: AgentConfigTabsComponentProps) {
  return (
    <>
      {/* Tab Bar */}
      <div className="flex border-b border-chatroom-border">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTabChange('remote');
          }}
          className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            activeTab === 'remote'
              ? 'text-chatroom-text-primary border-b-2 border-chatroom-accent'
              : 'text-chatroom-text-muted hover:text-chatroom-text-secondary'
          }`}
        >
          Remote
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTabChange('custom');
          }}
          className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            activeTab === 'custom'
              ? 'text-chatroom-text-primary border-b-2 border-chatroom-accent'
              : 'text-chatroom-text-muted hover:text-chatroom-text-secondary'
          }`}
        >
          Custom
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'remote' && (
        <RemoteTabContent
          controls={controls}
          connectedMachines={connectedMachines}
          isLoadingMachines={isLoadingMachines}
          daemonStartCommand={daemonStartCommand}
        />
      )}
      {activeTab === 'custom' && (
        <CustomTabContent role={role} prompt={prompt} onViewPrompt={onViewPrompt} />
      )}
    </>
  );
});
