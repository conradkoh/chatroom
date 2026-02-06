'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  Play,
  Square,
  X,
  AlertCircle,
  Loader2,
  CheckCircle,
  Copy,
  Check,
  ChevronLeft,
  RotateCw,
  ChevronDown,
} from 'lucide-react';
import React, { useCallback, memo, useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

import { CopyButton } from './CopyButton';

import { Badge } from '@/components/ui/badge';
import { usePrompts } from '@/contexts/PromptsContext';

type AgentTool = 'opencode' | 'claude' | 'cursor';

interface ToolVersionInfo {
  version: string;
  major: number;
}

interface MachineInfo {
  machineId: string;
  hostname: string;
  os: string;
  availableTools: AgentTool[];
  toolVersions: Partial<Record<AgentTool, ToolVersionInfo>>;
  daemonConnected: boolean;
  lastSeenAt: number;
}

interface AgentConfig {
  machineId: string;
  hostname: string;
  role: string;
  agentType: AgentTool;
  workingDir: string;
  daemonConnected: boolean;
  availableTools: AgentTool[];
  updatedAt: number;
  spawnedAgentPid?: number;
  spawnedAt?: number;
}

// Tool display names
const TOOL_DISPLAY_NAMES: Record<AgentTool, string> = {
  opencode: 'OpenCode',
  claude: 'Claude Code',
  cursor: 'Cursor Agent',
};

interface ChatroomAgentDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  role: string;
  effectiveStatus: string; // 'active' | 'waiting' | 'disconnected' | 'missing'
  onViewPrompt?: (role: string) => void;
  onBack?: () => void; // Optional back navigation (for multi-agent list context)
}

/**
 * Copy button component styled for chatroom theme
 */
function CopyPromptButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-2 px-3 py-1.5 bg-chatroom-accent text-chatroom-text-on-accent text-[10px] font-bold uppercase tracking-wider transition-all hover:opacity-90"
    >
      {copied ? (
        <>
          <Check size={12} />
          Copied!
        </>
      ) : (
        <>
          <Copy size={12} />
          Copy Prompt
        </>
      )}
    </button>
  );
}

/**
 * Unified modal for agent details, including start/stop functionality.
 * Consolidates SingleAgentModal, CollapsedAgentGroup modals, and StartAgentModal.
 */
export const ChatroomAgentDetailsModal = memo(function ChatroomAgentDetailsModal({
  isOpen,
  onClose,
  chatroomId,
  role,
  effectiveStatus,
  onViewPrompt,
  onBack,
}: ChatroomAgentDetailsModalProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const machinesApi = api as any;
  const { getAgentPrompt, isProductionUrl } = usePrompts();

  // Compute the full daemon start command with env var if needed
  const daemonStartCommand = useMemo(() => {
    if (isProductionUrl) {
      return 'chatroom machine daemon start';
    }
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    return `CHATROOM_CONVEX_URL=${convexUrl} chatroom machine daemon start`;
  }, [isProductionUrl]);

  // Fetch user's machines
  const machinesResult = useSessionQuery(machinesApi.machines.listMachines, {}) as
    | { machines: MachineInfo[] }
    | undefined;

  // Fetch agent configs for this chatroom
  const configsResult = useSessionQuery(machinesApi.machines.getAgentConfigs, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as { configs: AgentConfig[] } | undefined;

  // Send command mutation
  const sendCommand = useSessionMutation(machinesApi.machines.sendCommand);

  // Local state
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<AgentTool | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('default');
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Get prompt for this role
  const prompt = useMemo(() => getAgentPrompt(role) || '', [getAgentPrompt, role]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedMachineId(null);
      setSelectedTool(null);
      setSelectedModel('default');
      setIsStarting(false);
      setIsStopping(false);
      setError(null);
      setSuccess(null);
    }
  }, [isOpen]);

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

  // Get configs for this role
  const roleConfigs = useMemo(() => {
    if (!configsResult?.configs) return [];
    return configsResult.configs.filter((c) => c.role.toLowerCase() === role.toLowerCase());
  }, [configsResult?.configs, role]);

  // Get machines with daemon connected
  const connectedMachines = useMemo(() => {
    if (!machinesResult?.machines) return [];
    return machinesResult.machines.filter((m) => m.daemonConnected);
  }, [machinesResult?.machines]);

  // Check if there's a running agent (has PID)
  const runningAgentConfig = useMemo(() => {
    return roleConfigs.find((c) => c.spawnedAgentPid && c.daemonConnected);
  }, [roleConfigs]);

  // Get available tools for selected machine
  const availableToolsForMachine = useMemo(() => {
    if (!selectedMachineId || !machinesResult?.machines) return [];
    const machine = machinesResult.machines.find((m) => m.machineId === selectedMachineId);
    return machine?.availableTools || [];
  }, [selectedMachineId, machinesResult?.machines]);

  // Auto-select machine: prefer the machine with existing config, else first connected
  useEffect(() => {
    if (!selectedMachineId && connectedMachines.length > 0) {
      // If there's a running agent config, select that machine
      if (runningAgentConfig) {
        setSelectedMachineId(runningAgentConfig.machineId);
      } else if (roleConfigs.length > 0) {
        // Select machine that has an existing config for this role
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

  // Auto-select tool if there's a config for this machine/role
  useEffect(() => {
    if (selectedMachineId && roleConfigs.length > 0) {
      const config = roleConfigs.find((c) => c.machineId === selectedMachineId);
      if (config && availableToolsForMachine.includes(config.agentType)) {
        setSelectedTool(config.agentType);
      } else if (availableToolsForMachine.length === 1) {
        setSelectedTool(availableToolsForMachine[0]);
      }
    }
  }, [selectedMachineId, roleConfigs, availableToolsForMachine]);

  // Handle start agent
  const handleStartAgent = useCallback(async () => {
    if (!selectedMachineId || !selectedTool) return;

    setIsStarting(true);
    setError(null);

    try {
      await sendCommand({
        machineId: selectedMachineId,
        type: 'start-agent' as const,
        payload: {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
        },
      });

      setSuccess('Agent start command sent!');
      // Clear success after a short delay
      setTimeout(() => {
        setSuccess(null);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start agent');
    } finally {
      setIsStarting(false);
    }
  }, [selectedMachineId, selectedTool, sendCommand, chatroomId, role]);

  // Handle stop agent
  const handleStopAgent = useCallback(async () => {
    if (!runningAgentConfig) return;

    setIsStopping(true);
    setError(null);

    try {
      await sendCommand({
        machineId: runningAgentConfig.machineId,
        type: 'stop-agent' as const,
        payload: {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
        },
      });

      setSuccess('Agent stop command sent!');
      // Clear success after a short delay
      setTimeout(() => {
        setSuccess(null);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop agent');
    } finally {
      setIsStopping(false);
    }
  }, [runningAgentConfig, sendCommand, chatroomId, role]);

  // Handle restart agent (stop then start)
  const handleRestartAgent = useCallback(async () => {
    if (!runningAgentConfig) return;

    setIsStopping(true);
    setError(null);

    try {
      // Send stop command
      await sendCommand({
        machineId: runningAgentConfig.machineId,
        type: 'stop-agent' as const,
        payload: {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
        },
      });

      // Wait a moment then send start
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setIsStopping(false);
      setIsStarting(true);

      await sendCommand({
        machineId: runningAgentConfig.machineId,
        type: 'start-agent' as const,
        payload: {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
        },
      });

      setSuccess('Agent restart command sent!');
      setTimeout(() => {
        setSuccess(null);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart agent');
    } finally {
      setIsStarting(false);
      setIsStopping(false);
    }
  }, [runningAgentConfig, sendCommand, chatroomId, role]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Available models (placeholder for future extension)
  const availableModels = useMemo(() => [{ value: 'default', label: 'Default' }], []);

  if (!isOpen) return null;

  const isLoading = machinesResult === undefined || configsResult === undefined;
  const hasNoMachines = !isLoading && connectedMachines.length === 0;
  const isAgentRunning = !!runningAgentConfig;
  const canStart = selectedMachineId && selectedTool && !isStarting && !isAgentRunning && !success;
  const canStop = isAgentRunning && !isStopping && !success;
  const canRestart = isAgentRunning && !isStopping && !isStarting && !success;
  const isBusy = isStarting || isStopping;

  // Status display
  const statusLabel =
    effectiveStatus === 'missing'
      ? 'NOT JOINED'
      : effectiveStatus === 'disconnected'
        ? 'DISCONNECTED'
        : effectiveStatus === 'waiting'
          ? 'READY'
          : effectiveStatus === 'active'
            ? 'WORKING'
            : 'IDLE';

  const indicatorColor =
    effectiveStatus === 'active'
      ? 'bg-chatroom-status-info'
      : effectiveStatus === 'waiting'
        ? 'bg-chatroom-status-success'
        : effectiveStatus === 'disconnected'
          ? 'bg-chatroom-status-error'
          : 'bg-chatroom-text-muted';

  const badgeVariant =
    effectiveStatus === 'active'
      ? 'default'
      : effectiveStatus === 'waiting'
        ? 'secondary'
        : effectiveStatus === 'disconnected'
          ? 'destructive'
          : ('outline' as const);

  // Use portal to render at document root, escaping any parent stacking context
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className="chatroom-root w-full max-w-md max-h-[85vh] flex flex-col bg-chatroom-bg-primary border-2 border-chatroom-border-strong overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                onClick={onBack}
                className="w-6 h-6 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors -ml-1 mr-1"
                aria-label="Back to agent list"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <div className={`w-2.5 h-2.5 ${indicatorColor}`} />
            <h2 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
              {role.toUpperCase()}
            </h2>
            <Badge variant={badgeVariant} className="text-[10px]">
              {statusLabel}
            </Badge>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Running agent info banner */}
          {runningAgentConfig && (
            <div className="p-3 bg-chatroom-bg-tertiary border border-chatroom-status-info/30 space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-chatroom-status-info rounded-full animate-pulse" />
                <span className="text-xs font-bold text-chatroom-text-primary">Agent Running</span>
              </div>
              <div className="text-[10px] text-chatroom-text-muted">
                <span>Machine: {runningAgentConfig.hostname}</span>
                {' · '}
                <span>Tool: {TOOL_DISPLAY_NAMES[runningAgentConfig.agentType]}</span>
                {' · '}
                <span>PID: {runningAgentConfig.spawnedAgentPid}</span>
              </div>
            </div>
          )}

          {/* Success message */}
          {success && (
            <div className="flex items-center gap-2 p-3 bg-chatroom-status-success/10 border border-chatroom-status-success/30">
              <CheckCircle size={14} className="text-chatroom-status-success flex-shrink-0" />
              <p className="text-xs text-chatroom-status-success font-bold">{success}</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-chatroom-status-error/10 border border-chatroom-status-error/30">
              <AlertCircle size={14} className="text-chatroom-status-error flex-shrink-0" />
              <p className="text-xs text-chatroom-status-error">{error}</p>
            </div>
          )}

          {/* Agent Prompt Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                Agent Prompt
              </span>
              <CopyPromptButton text={prompt} />
            </div>
            <button
              className="w-full text-left text-xs text-chatroom-text-secondary font-mono whitespace-pre-wrap break-words bg-chatroom-bg-tertiary p-3 max-h-40 overflow-y-auto hover:text-chatroom-text-primary transition-colors"
              onClick={() => {
                onViewPrompt?.(role);
                onClose();
              }}
              title="Click to view full prompt"
            >
              {prompt.length > 300 ? prompt.substring(0, 300) + '...' : prompt}
            </button>
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface px-3 py-2.5">
          {isLoading ? (
            <div className="flex items-center justify-center py-1">
              <Loader2 size={16} className="animate-spin text-chatroom-text-muted" />
              <span className="ml-2 text-[10px] text-chatroom-text-muted">Loading machines...</span>
            </div>
          ) : hasNoMachines ? (
            <div className="space-y-2 py-1">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-chatroom-status-warning flex-shrink-0" />
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
            <div className="flex items-center gap-2">
              {/* Machine Selection Dropdown */}
              <div className="relative flex-shrink-0">
                <select
                  value={selectedMachineId || ''}
                  onChange={(e) => {
                    setSelectedMachineId(e.target.value || null);
                    setSelectedTool(null);
                  }}
                  disabled={isBusy || isAgentRunning}
                  className="appearance-none bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary pl-2 pr-6 py-1.5 cursor-pointer hover:border-chatroom-border-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-chatroom-accent min-w-0 max-w-[120px] truncate"
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

              {/* Tool Selection Dropdown */}
              <div className="relative flex-shrink-0">
                <select
                  value={selectedTool || ''}
                  onChange={(e) => setSelectedTool((e.target.value as AgentTool) || null)}
                  disabled={
                    isBusy ||
                    isAgentRunning ||
                    !selectedMachineId ||
                    availableToolsForMachine.length === 0
                  }
                  className="appearance-none bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary pl-2 pr-6 py-1.5 cursor-pointer hover:border-chatroom-border-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-chatroom-accent min-w-0 max-w-[120px] truncate"
                  title="Select Tool"
                >
                  <option value="">Tool...</option>
                  {availableToolsForMachine.map((tool) => (
                    <option key={tool} value={tool}>
                      {TOOL_DISPLAY_NAMES[tool]}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={10}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-chatroom-text-muted pointer-events-none"
                />
              </div>

              {/* Model Selection Dropdown */}
              <div className="relative flex-shrink-0">
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={isBusy}
                  className="appearance-none bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary pl-2 pr-6 py-1.5 cursor-pointer hover:border-chatroom-border-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-chatroom-accent min-w-0 max-w-[100px] truncate"
                  title="Select Model"
                >
                  {availableModels.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={10}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-chatroom-text-muted pointer-events-none"
                />
              </div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Action Buttons */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {isAgentRunning ? (
                  <>
                    {/* Stop Button */}
                    <button
                      onClick={handleStopAgent}
                      disabled={!canStop}
                      className={`w-8 h-8 flex items-center justify-center transition-all ${
                        canStop
                          ? 'text-chatroom-status-error hover:bg-chatroom-status-error/10'
                          : 'text-chatroom-text-muted cursor-not-allowed opacity-50'
                      }`}
                      title="Stop Agent"
                    >
                      {isStopping ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                    {/* Restart Button */}
                    <button
                      onClick={handleRestartAgent}
                      disabled={!canRestart}
                      className={`w-8 h-8 flex items-center justify-center transition-all ${
                        canRestart
                          ? 'text-chatroom-status-info hover:bg-chatroom-status-info/10'
                          : 'text-chatroom-text-muted cursor-not-allowed opacity-50'
                      }`}
                      title="Restart Agent"
                    >
                      {isStarting ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <RotateCw size={16} />
                      )}
                    </button>
                  </>
                ) : (
                  /* Start Button */
                  <button
                    onClick={handleStartAgent}
                    disabled={!canStart}
                    className={`w-8 h-8 flex items-center justify-center transition-all ${
                      canStart
                        ? 'text-chatroom-status-success hover:bg-chatroom-status-success/10'
                        : 'text-chatroom-text-muted cursor-not-allowed opacity-50'
                    }`}
                    title="Start Agent"
                  >
                    {isStarting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Play size={16} />
                    )}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
});
