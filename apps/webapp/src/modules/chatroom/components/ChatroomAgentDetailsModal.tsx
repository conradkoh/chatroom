'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  Play,
  Square,
  X,
  Monitor,
  AlertCircle,
  Loader2,
  CheckCircle,
  Copy,
  Check,
  ChevronLeft,
} from 'lucide-react';
import React, { useCallback, memo, useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

import { Badge } from '@/components/ui/badge';
import { usePrompts } from '@/contexts/PromptsContext';

type AgentTool = 'opencode' | 'claude' | 'cursor';

interface MachineInfo {
  machineId: string;
  hostname: string;
  os: string;
  availableTools: AgentTool[];
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
  const { getAgentPrompt } = usePrompts();

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
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showMachineSelector, setShowMachineSelector] = useState(false);

  // Get prompt for this role
  const prompt = useMemo(() => getAgentPrompt(role) || '', [getAgentPrompt, role]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedMachineId(null);
      setSelectedTool(null);
      setIsStarting(false);
      setIsStopping(false);
      setError(null);
      setSuccess(null);
      setShowMachineSelector(false);
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

  // Auto-select first machine if only one is available
  useEffect(() => {
    if (connectedMachines.length === 1 && !selectedMachineId && showMachineSelector) {
      setSelectedMachineId(connectedMachines[0].machineId);
    }
  }, [connectedMachines, selectedMachineId, showMachineSelector]);

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
      setShowMachineSelector(false);
      // Close modal after a short delay to show success
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start agent');
    } finally {
      setIsStarting(false);
    }
  }, [selectedMachineId, selectedTool, sendCommand, chatroomId, role, onClose]);

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
      // Close modal after a short delay to show success
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop agent');
    } finally {
      setIsStopping(false);
    }
  }, [runningAgentConfig, sendCommand, chatroomId, role, onClose]);

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

  if (!isOpen) return null;

  const isLoading = machinesResult === undefined || configsResult === undefined;
  const hasNoMachines = !isLoading && connectedMachines.length === 0;
  const canStart = selectedMachineId && selectedTool && !isStarting && !success;
  const canStop = runningAgentConfig && !isStopping && !success;

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
          {success ? (
            <div className="text-center py-8 space-y-3">
              <CheckCircle size={32} className="mx-auto text-chatroom-status-success" />
              <p className="text-sm text-chatroom-text-primary font-bold">{success}</p>
            </div>
          ) : (
            <>
              {/* Agent Control Section */}
              <div className="space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                  Agent Control
                </div>

                {/* Running agent info */}
                {runningAgentConfig && (
                  <div className="p-3 bg-chatroom-bg-tertiary border border-chatroom-status-info/30 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-chatroom-status-info rounded-full animate-pulse" />
                      <span className="text-xs font-bold text-chatroom-text-primary">
                        Agent Running
                      </span>
                    </div>
                    <div className="text-[10px] text-chatroom-text-muted">
                      <span>Machine: {runningAgentConfig.hostname}</span>
                      <br />
                      <span>Tool: {TOOL_DISPLAY_NAMES[runningAgentConfig.agentType]}</span>
                      <br />
                      <span>PID: {runningAgentConfig.spawnedAgentPid}</span>
                    </div>
                    <button
                      onClick={handleStopAgent}
                      disabled={!canStop}
                      className={`w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                        canStop
                          ? 'bg-chatroom-status-error text-white hover:bg-chatroom-status-error/90'
                          : 'bg-chatroom-bg-tertiary text-chatroom-text-muted cursor-not-allowed'
                      }`}
                    >
                      {isStopping ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Stopping...
                        </>
                      ) : (
                        <>
                          <Square size={12} />
                          Stop Agent
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Start agent section */}
                {!runningAgentConfig && (
                  <>
                    {!showMachineSelector ? (
                      <button
                        onClick={() => setShowMachineSelector(true)}
                        disabled={isLoading}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-chatroom-status-info text-white text-xs font-bold uppercase tracking-wider hover:bg-chatroom-status-info/90 transition-colors disabled:opacity-50"
                      >
                        <Play size={14} />
                        Start Agent Remotely
                      </button>
                    ) : isLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 size={24} className="animate-spin text-chatroom-text-muted" />
                      </div>
                    ) : hasNoMachines ? (
                      <div className="text-center py-4 space-y-2">
                        <AlertCircle size={24} className="mx-auto text-chatroom-status-warning" />
                        <p className="text-xs text-chatroom-text-secondary">
                          No machines with daemon running.
                        </p>
                        <code className="block bg-chatroom-bg-tertiary px-2 py-1 text-[10px] font-mono text-chatroom-status-success">
                          chatroom machine daemon start
                        </code>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Machine Selection */}
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                            Select Machine
                          </label>
                          <div className="space-y-1">
                            {connectedMachines.map((machine) => (
                              <button
                                key={machine.machineId}
                                onClick={() => {
                                  setSelectedMachineId(machine.machineId);
                                  setSelectedTool(null);
                                }}
                                className={`w-full flex items-center gap-2 p-2 border transition-all ${
                                  selectedMachineId === machine.machineId
                                    ? 'border-chatroom-accent bg-chatroom-accent-subtle'
                                    : 'border-chatroom-border hover:border-chatroom-border-strong hover:bg-chatroom-bg-hover'
                                }`}
                              >
                                <Monitor size={14} className="text-chatroom-text-muted" />
                                <span className="text-xs font-bold text-chatroom-text-primary flex-1 text-left">
                                  {machine.hostname}
                                </span>
                                <div className="w-2 h-2 bg-chatroom-status-success rounded-full" />
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Tool Selection */}
                        {selectedMachineId && availableToolsForMachine.length > 0 && (
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                              Select Tool
                            </label>
                            <div className="flex flex-wrap gap-1">
                              {availableToolsForMachine.map((tool) => (
                                <button
                                  key={tool}
                                  onClick={() => setSelectedTool(tool)}
                                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                                    selectedTool === tool
                                      ? 'bg-chatroom-accent text-chatroom-text-on-accent'
                                      : 'bg-chatroom-bg-tertiary text-chatroom-text-secondary hover:bg-chatroom-bg-hover'
                                  }`}
                                >
                                  {TOOL_DISPLAY_NAMES[tool]}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Start Button */}
                        <button
                          onClick={handleStartAgent}
                          disabled={!canStart}
                          className={`w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                            canStart
                              ? 'bg-chatroom-status-info text-white hover:bg-chatroom-status-info/90'
                              : 'bg-chatroom-bg-tertiary text-chatroom-text-muted cursor-not-allowed'
                          }`}
                        >
                          {isStarting ? (
                            <>
                              <Loader2 size={12} className="animate-spin" />
                              Starting...
                            </>
                          ) : (
                            <>
                              <Play size={12} />
                              Start Agent
                            </>
                          )}
                        </button>

                        {/* Cancel */}
                        <button
                          onClick={() => setShowMachineSelector(false)}
                          className="w-full text-center text-[10px] text-chatroom-text-muted hover:text-chatroom-text-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-chatroom-status-error/10 border border-chatroom-status-error/30">
                  <AlertCircle size={14} className="text-chatroom-status-error flex-shrink-0" />
                  <p className="text-xs text-chatroom-status-error">{error}</p>
                </div>
              )}

              {/* Agent Prompt Section */}
              <div className="space-y-2 pt-2 border-t border-chatroom-border">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                    Agent Prompt
                  </span>
                  <CopyPromptButton text={prompt} />
                </div>
                <button
                  className="w-full text-left text-xs text-chatroom-text-secondary font-mono whitespace-pre-wrap break-words bg-chatroom-bg-tertiary p-3 max-h-32 overflow-y-auto hover:text-chatroom-text-primary transition-colors"
                  onClick={() => {
                    onViewPrompt?.(role);
                    onClose();
                  }}
                  title="Click to view full prompt"
                >
                  {prompt.length > 300 ? prompt.substring(0, 300) + '...' : prompt}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
});
