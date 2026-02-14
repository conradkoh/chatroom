'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import {
  Play,
  Square,
  RotateCw,
  Loader2,
  AlertCircle,
  ChevronDown,
  CheckCircle,
} from 'lucide-react';
import React, { useState, useMemo, useCallback, memo, useEffect } from 'react';

import { CopyButton } from './CopyButton';
import type {
  AgentHarness,
  HarnessVersionInfo,
  MachineInfo,
  AgentConfig,
  SendCommandFn,
} from '../types/machine';
import { HARNESS_DISPLAY_NAMES, getModelDisplayLabel } from '../types/machine';

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

// ─── Hook: useAgentControls ─────────────────────────────────────────
// Encapsulates all state + logic for machine/harness/model selection and
// start/stop/restart actions. Used by both the shared tab content and
// any container that needs programmatic access.

export function useAgentControls({
  role,
  chatroomId,
  connectedMachines,
  agentConfigs,
  sendCommand,
  teamConfigModel,
}: {
  role: string;
  chatroomId: string;
  connectedMachines: MachineInfo[];
  agentConfigs: AgentConfig[];
  sendCommand: AgentConfigTabsProps['sendCommand'];
  /** Model from team config — used as fallback when machine config has no model */
  teamConfigModel?: string;
}) {
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedHarness, setSelectedHarness] = useState<AgentHarness | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [workingDir, setWorkingDir] = useState<string>('');
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Track if user has manually set these values (prevents auto-selection override)
  const [isModelManuallySet, setIsModelManuallySet] = useState(false);
  const [isWorkingDirManuallySet, setIsWorkingDirManuallySet] = useState(false);

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

  // Auto-select machine (priority: running agent > role config > first available)
  useEffect(() => {
    if (!selectedMachineId && connectedMachines.length > 0) {
      if (runningAgentConfig) {
        setSelectedMachineId(runningAgentConfig.machineId);
      } else if (roleConfigs.length > 0) {
        const configMachine = connectedMachines.find((m) =>
          roleConfigs.some((c) => c.machineId === m.machineId)
        );
        if (configMachine) {
          setSelectedMachineId(configMachine.machineId);
        } else {
          setSelectedMachineId(connectedMachines[0].machineId);
        }
      } else {
        setSelectedMachineId(connectedMachines[0].machineId);
      }
    }
  }, [connectedMachines, selectedMachineId, runningAgentConfig, roleConfigs]);

  // Available models from the selected machine (discovered dynamically)
  const availableModelsForHarness = useMemo(() => {
    if (!selectedMachineId || !selectedHarness) return [];
    const machine = connectedMachines.find((m) => m.machineId === selectedMachineId);
    return machine?.availableModels || [];
  }, [selectedMachineId, selectedHarness, connectedMachines]);

  // Auto-select harness (priority: role config > single available harness)
  useEffect(() => {
    if (selectedMachineId) {
      const config = roleConfigs.find((c) => c.machineId === selectedMachineId);
      if (config && availableHarnessesForMachine.includes(config.agentType)) {
        setSelectedHarness(config.agentType);
        return;
      }
      if (availableHarnessesForMachine.length === 1) {
        setSelectedHarness(availableHarnessesForMachine[0]);
      }
    }
  }, [selectedMachineId, roleConfigs, availableHarnessesForMachine]);

  // Auto-select model when harness or machine changes
  // Priority: machine config model > team config model > first available model
  // Skip if user has manually set the model
  useEffect(() => {
    if (isModelManuallySet) return; // User manually selected, don't override

    if (selectedHarness) {
      const models = availableModelsForHarness;
      if (models.length === 0) {
        setSelectedModel(null);
        return;
      }
      // Try machine config model first
      const config = roleConfigs.find((c) => c.machineId === selectedMachineId && c.model);
      if (config?.model && models.includes(config.model)) {
        setSelectedModel(config.model);
        return;
      }
      // Fall back to team config model
      if (teamConfigModel && models.includes(teamConfigModel)) {
        setSelectedModel(teamConfigModel);
        return;
      }
      // Last resort: first available model
      setSelectedModel(models[0]);
    } else {
      setSelectedModel(null);
    }
  }, [
    selectedHarness,
    availableModelsForHarness,
    roleConfigs,
    selectedMachineId,
    isModelManuallySet,
    teamConfigModel,
  ]);

  // Pre-populate workingDir from existing config when switching machines
  // Skip if user has manually set the working directory
  useEffect(() => {
    if (isWorkingDirManuallySet) return; // User manually set, don't override

    if (selectedMachineId) {
      const existingConfig = roleConfigs.find((c) => c.machineId === selectedMachineId);
      if (existingConfig?.workingDir) {
        setWorkingDir(existingConfig.workingDir);
        return;
      }
    }
    if (roleConfigs.length > 0) {
      const latest = roleConfigs.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
      if (latest.workingDir) {
        setWorkingDir(latest.workingDir);
        return;
      }
    }
    setWorkingDir('');
  }, [selectedMachineId, roleConfigs, isWorkingDirManuallySet]);

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

  // Wrapper for machine change - resets manual flags since options change
  const handleMachineChange = useCallback((machineId: string | null) => {
    setSelectedMachineId(machineId);
    setSelectedHarness(null);
    // Reset manual flags since machine change means different available options
    setIsModelManuallySet(false);
    setIsWorkingDirManuallySet(false);
  }, []);

  // Wrapper for harness change - resets model manual flag since models may differ
  const handleHarnessChange = useCallback((harness: AgentHarness | null) => {
    setSelectedHarness(harness);
    setSelectedModel(null);
    // Reset model manual flag since harness change means different available models
    setIsModelManuallySet(false);
  }, []);

  // Wrapper for user manually selecting a model
  const handleModelChange = useCallback((model: string | null) => {
    setSelectedModel(model);
    setIsModelManuallySet(true);
  }, []);

  // Wrapper for user manually changing working directory
  const handleWorkingDirChange = useCallback((dir: string) => {
    setWorkingDir(dir);
    setIsWorkingDirManuallySet(true);
  }, []);

  return {
    selectedMachineId,
    setSelectedMachineId,
    selectedHarness,
    setSelectedHarness,
    selectedModel,
    setSelectedModel,
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
    // New wrapper functions that track manual changes
    handleMachineChange,
    handleHarnessChange,
    handleModelChange,
    handleWorkingDirChange,
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
    isAgentRunning,
    isBusy,
    hasModels,
    canStart,
    canStop,
    canRestart,
    handleStartAgent,
    handleStopAgent,
    handleRestartAgent,
    // Use wrapper functions that track manual changes
    handleMachineChange,
    handleHarnessChange,
    handleModelChange,
    handleWorkingDirChange,
  } = controls;

  const hasNoMachines = !isLoadingMachines && connectedMachines.length === 0;

  return (
    <div className="bg-chatroom-bg-surface border border-chatroom-border px-2.5 py-2 space-y-2">
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
            <div className="relative flex-1 min-w-0">
              <select
                value={selectedMachineId || ''}
                onChange={(e) => handleMachineChange(e.target.value || null)}
                disabled={isBusy || isAgentRunning}
                className="w-full appearance-none bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary pl-2 pr-6 py-1.5 cursor-pointer hover:border-chatroom-border-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-chatroom-accent truncate"
                title="Select Machine"
              >
                <option value="">Machine...</option>
                {connectedMachines.map((machine) => (
                  <option key={machine.machineId} value={machine.machineId}>
                    {machine.hostname}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={10}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-chatroom-text-muted pointer-events-none"
              />
            </div>
            <div className="relative flex-1 min-w-0">
              <select
                value={selectedHarness || ''}
                onChange={(e) => handleHarnessChange((e.target.value as AgentHarness) || null)}
                disabled={
                  isBusy ||
                  isAgentRunning ||
                  !selectedMachineId ||
                  availableHarnessesForMachine.length === 0
                }
                className="w-full appearance-none bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary pl-2 pr-6 py-1.5 cursor-pointer hover:border-chatroom-border-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-chatroom-accent truncate"
                title="Select Harness"
              >
                <option value="">Harness...</option>
                {availableHarnessesForMachine.map((harness) => {
                  const ver = harnessVersionsForMachine[harness];
                  return (
                    <option key={harness} value={harness}>
                      {HARNESS_DISPLAY_NAMES[harness]}
                      {ver ? ` v${ver.version}` : ''}
                    </option>
                  );
                })}
              </select>
              <ChevronDown
                size={10}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-chatroom-text-muted pointer-events-none"
              />
            </div>
          </div>

          {/* Row 2: Working Directory */}
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={workingDir}
              onChange={(e) => handleWorkingDirChange(e.target.value)}
              placeholder="/path/to/project"
              disabled={isBusy || isAgentRunning}
              className="flex-1 bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-mono text-chatroom-text-primary px-2 py-1.5 placeholder:text-chatroom-text-muted/50 focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed"
              title="Working directory for agent (absolute path on remote machine)"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            />
            {workingDir.trim() && (
              <CopyButton
                text={workingDir.trim()}
                label="Copy Path"
                copiedLabel="Copied!"
                variant="compact"
              />
            )}
          </div>

          {/* Row 3: Model + Start/Stop */}
          <div className="flex items-center gap-2">
            {hasModels ? (
              <div className="relative flex-1 min-w-0">
                <select
                  value={selectedModel || ''}
                  onChange={(e) => handleModelChange(e.target.value || null)}
                  disabled={isBusy || isAgentRunning || !selectedHarness}
                  className="w-full appearance-none bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary pl-2 pr-6 py-1.5 cursor-pointer hover:border-chatroom-border-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-chatroom-accent truncate"
                  title="Select Model"
                >
                  <option value="">Model...</option>
                  {availableModelsForHarness.map((model) => (
                    <option key={model} value={model}>
                      {getModelDisplayLabel(model)}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={10}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-chatroom-text-muted pointer-events-none"
                />
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
  onViewPrompt,
}: CustomTabContentProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Prompt
        </span>
        <CopyButton text={prompt} label="Copy Prompt" copiedLabel="Copied!" />
      </div>
      <button
        className="w-full text-left text-[11px] text-chatroom-text-secondary font-mono whitespace-pre-wrap break-words bg-chatroom-bg-tertiary p-2.5 max-h-32 overflow-y-auto hover:text-chatroom-text-primary transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onViewPrompt?.(role);
        }}
        title="Click to view full prompt"
      >
        {prompt.length > 200 ? prompt.substring(0, 200) + '...' : prompt}
      </button>
    </div>
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
        <div className="p-2.5 bg-chatroom-bg-tertiary border border-chatroom-status-info/30 space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-chatroom-status-info rounded-full animate-pulse" />
            <span className="text-[10px] font-bold text-chatroom-text-primary">Agent Running</span>
            <span className="text-[10px] text-chatroom-text-muted">
              PID {runningAgentConfig.spawnedAgentPid}
            </span>
          </div>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-2 bg-chatroom-status-success/10 border border-chatroom-status-success/30">
          <CheckCircle size={12} className="text-chatroom-status-success flex-shrink-0" />
          <p className="text-[10px] text-chatroom-status-success font-bold">{success}</p>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-2 bg-chatroom-status-error/10 border border-chatroom-status-error/30">
          <AlertCircle size={12} className="text-chatroom-status-error flex-shrink-0" />
          <p className="text-[10px] text-chatroom-status-error">{error}</p>
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
