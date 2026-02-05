'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Play, X, Monitor, AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import React, { useCallback, memo, useMemo, useState, useEffect } from 'react';

interface StartAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  role: string;
}

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
}

// Tool display names
const TOOL_DISPLAY_NAMES: Record<AgentTool, string> = {
  opencode: 'OpenCode',
  claude: 'Claude Code',
  cursor: 'Cursor Agent',
};

/**
 * Modal for starting an agent remotely on a registered machine.
 * Shows available machines and their agent tools.
 */
export const StartAgentModal = memo(function StartAgentModal({
  isOpen,
  onClose,
  chatroomId,
  role,
}: StartAgentModalProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const machinesApi = api as any;

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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedMachineId(null);
      setSelectedTool(null);
      setIsStarting(false);
      setError(null);
      setSuccess(false);
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

  // Get available tools for selected machine
  const availableToolsForMachine = useMemo(() => {
    if (!selectedMachineId || !machinesResult?.machines) return [];
    const machine = machinesResult.machines.find((m) => m.machineId === selectedMachineId);
    return machine?.availableTools || [];
  }, [selectedMachineId, machinesResult?.machines]);

  // Auto-select first machine if only one is available
  useEffect(() => {
    if (connectedMachines.length === 1 && !selectedMachineId) {
      setSelectedMachineId(connectedMachines[0].machineId);
    }
  }, [connectedMachines, selectedMachineId]);

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

      setSuccess(true);
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className="chatroom-root w-full max-w-md max-h-[85vh] flex flex-col bg-chatroom-bg-primary border-2 border-chatroom-border-strong overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface">
          <div className="flex items-center gap-2">
            <Play size={18} className="text-chatroom-status-info" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
              Start Agent: {role.toUpperCase()}
            </h2>
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
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-chatroom-text-muted" />
            </div>
          ) : hasNoMachines ? (
            <div className="text-center py-8 space-y-3">
              <AlertCircle size={32} className="mx-auto text-chatroom-status-warning" />
              <p className="text-sm text-chatroom-text-secondary">
                No machines with daemon running.
              </p>
              <p className="text-xs text-chatroom-text-muted">
                Start the daemon on your machine with:
              </p>
              <code className="block bg-chatroom-bg-tertiary px-3 py-2 text-xs font-mono text-chatroom-status-success">
                chatroom machine daemon start
              </code>
            </div>
          ) : success ? (
            <div className="text-center py-8 space-y-3">
              <CheckCircle size={32} className="mx-auto text-chatroom-status-success" />
              <p className="text-sm text-chatroom-text-primary font-bold">
                Agent start command sent!
              </p>
              <p className="text-xs text-chatroom-text-secondary">
                The agent should start shortly on the selected machine.
              </p>
            </div>
          ) : (
            <>
              {/* Machine Selection */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                  Select Machine
                </label>
                <div className="space-y-2">
                  {connectedMachines.map((machine) => (
                    <button
                      key={machine.machineId}
                      onClick={() => {
                        setSelectedMachineId(machine.machineId);
                        setSelectedTool(null);
                      }}
                      className={`w-full flex items-center gap-3 p-3 border-2 transition-all ${
                        selectedMachineId === machine.machineId
                          ? 'border-chatroom-accent bg-chatroom-accent-subtle'
                          : 'border-chatroom-border hover:border-chatroom-border-strong hover:bg-chatroom-bg-hover'
                      }`}
                    >
                      <Monitor
                        size={16}
                        className={
                          selectedMachineId === machine.machineId
                            ? 'text-chatroom-accent'
                            : 'text-chatroom-text-muted'
                        }
                      />
                      <div className="flex-1 text-left">
                        <div className="text-xs font-bold text-chatroom-text-primary">
                          {machine.hostname}
                        </div>
                        <div className="text-[10px] text-chatroom-text-muted">
                          {machine.os} • {machine.availableTools.length} tools available
                        </div>
                      </div>
                      <div className="w-2 h-2 bg-chatroom-status-success rounded-full" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Tool Selection */}
              {selectedMachineId && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                    Select Agent Tool
                  </label>
                  <div className="space-y-2">
                    {availableToolsForMachine.length === 0 ? (
                      <p className="text-xs text-chatroom-text-muted py-2">
                        No agent tools available on this machine.
                      </p>
                    ) : (
                      availableToolsForMachine.map((tool) => (
                        <button
                          key={tool}
                          onClick={() => setSelectedTool(tool)}
                          className={`w-full flex items-center gap-3 p-3 border-2 transition-all ${
                            selectedTool === tool
                              ? 'border-chatroom-accent bg-chatroom-accent-subtle'
                              : 'border-chatroom-border hover:border-chatroom-border-strong hover:bg-chatroom-bg-hover'
                          }`}
                        >
                          <div className="flex-1 text-left">
                            <div className="text-xs font-bold text-chatroom-text-primary">
                              {TOOL_DISPLAY_NAMES[tool]}
                            </div>
                          </div>
                          {selectedTool === tool && (
                            <CheckCircle size={14} className="text-chatroom-accent" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-chatroom-status-error/10 border border-chatroom-status-error/30">
                  <AlertCircle size={14} className="text-chatroom-status-error flex-shrink-0" />
                  <p className="text-xs text-chatroom-status-error">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!isLoading && !hasNoMachines && !success && (
          <div className="px-4 py-3 border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-chatroom-text-secondary hover:text-chatroom-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleStartAgent}
              disabled={!canStart}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                canStart
                  ? 'bg-chatroom-accent text-chatroom-text-on-accent hover:opacity-90'
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
          </div>
        )}
      </div>
    </div>
  );
});
