'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Rocket, Check, Lightbulb, Terminal } from 'lucide-react';
import React, { useMemo, useCallback, memo, useState } from 'react';

import { useAgentControls, AgentConfigTabs, AgentStatusBanner } from './AgentConfigTabs';
import { CopyButton } from './CopyButton';
import type { MachineInfo, AgentConfig, SendCommandFn } from '../types/machine';

import { usePrompts } from '@/contexts/PromptsContext';

// ─── Types ──────────────────────────────────────────────────────────

interface Participant {
  role: string;
  status: string;
}

interface SetupChecklistProps {
  chatroomId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  participants: Participant[];
  onViewPrompt: (role: string) => void;
}

// ─── Setup Agent Card ───────────────────────────────────────────────
// Per-role card shown in setup mode: step number + status badge + tabs.

interface SetupAgentCardProps {
  role: string;
  index: number;
  isJoined: boolean;
  prompt: string;
  chatroomId: string;
  connectedMachines: MachineInfo[];
  agentConfigs: AgentConfig[];
  isLoadingMachines: boolean;
  daemonStartCommand: string;
  sendCommand: SendCommandFn;
  onViewPrompt: (role: string) => void;
}

const SetupAgentCard = memo(function SetupAgentCard({
  role,
  index,
  isJoined,
  prompt,
  chatroomId,
  connectedMachines,
  agentConfigs,
  isLoadingMachines,
  daemonStartCommand,
  sendCommand,
  onViewPrompt,
}: SetupAgentCardProps) {
  const [activeTab, setActiveTab] = useState<'remote' | 'custom'>('remote');

  const controls = useAgentControls({
    role,
    chatroomId,
    connectedMachines,
    agentConfigs,
    sendCommand,
  });

  return (
    <div
      className={`bg-chatroom-bg-surface border-2 transition-all duration-100 ${
        isJoined
          ? 'border-chatroom-status-success/30 bg-chatroom-status-success/5'
          : 'border-chatroom-border hover:border-chatroom-border-strong'
      }`}
    >
      {/* Step Header */}
      <div className="flex justify-between items-center p-4">
        <div className="flex items-center gap-3">
          <span
            className={`w-6 h-6 flex items-center justify-center text-xs font-bold ${
              isJoined
                ? 'bg-chatroom-status-success text-chatroom-bg-primary'
                : 'bg-chatroom-bg-hover text-chatroom-text-muted'
            }`}
          >
            {isJoined ? <Check size={14} /> : index + 1}
          </span>
          <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
            {role}
          </span>
        </div>
        <span
          className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            isJoined
              ? 'bg-chatroom-status-success/15 text-chatroom-status-success'
              : 'bg-chatroom-status-warning/15 text-chatroom-status-warning'
          }`}
        >
          {isJoined ? 'Ready' : 'Waiting'}
        </span>
      </div>

      {/* Card Content - tabs for pending steps, collapsed for joined */}
      {!isJoined && (
        <div className="px-4 pb-4 space-y-3">
          <AgentStatusBanner controls={controls} />
          <AgentConfigTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            controls={controls}
            role={role}
            prompt={prompt}
            connectedMachines={connectedMachines}
            isLoadingMachines={isLoadingMachines}
            daemonStartCommand={daemonStartCommand}
            onViewPrompt={onViewPrompt}
          />
        </div>
      )}
    </div>
  );
});

// ─── Main Component ─────────────────────────────────────────────────

export const SetupChecklist = memo(function SetupChecklist({
  chatroomId,
  teamName: _teamName,
  teamRoles,
  teamEntryPoint: _teamEntryPoint,
  participants,
  onViewPrompt,
}: SetupChecklistProps) {
  const { getAgentPrompt, isProductionUrl } = usePrompts();

  // ── Machine data (same pattern as UnifiedAgentListModal) ──────────
  const machinesResult = useSessionQuery(api.machines.listMachines, {}) as
    | { machines: MachineInfo[] }
    | undefined;

  const configsResult = useSessionQuery(api.machines.getAgentConfigs, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as { configs: AgentConfig[] } | undefined;

  const sendCommand = useSessionMutation(api.machines.sendCommand);

  const connectedMachines = useMemo(() => {
    if (!machinesResult?.machines) return [];
    return machinesResult.machines.filter((m) => m.daemonConnected);
  }, [machinesResult?.machines]);

  const agentConfigs = useMemo(() => {
    return configsResult?.configs || [];
  }, [configsResult?.configs]);

  const isLoadingMachines = machinesResult === undefined || configsResult === undefined;

  // Compute the full daemon start command with env var if needed
  const daemonStartCommand = useMemo(() => {
    if (isProductionUrl) {
      return 'chatroom machine daemon start';
    }
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    return `CHATROOM_CONVEX_URL=${convexUrl} chatroom machine daemon start`;
  }, [isProductionUrl]);

  // ── Participants & prompts ────────────────────────────────────────

  // Memoize participant map
  const participantMap = useMemo(
    () => new Map(participants.map((p) => [p.role.toLowerCase(), p])),
    [participants]
  );

  // Memoize prompt generation - now using context
  const generatePrompt = useCallback(
    (role: string): string => {
      return getAgentPrompt(role) || '';
    },
    [getAgentPrompt]
  );

  // Generate the auth login command with appropriate env vars
  const authLoginCommand = useMemo(() => {
    if (isProductionUrl) {
      return 'chatroom auth login';
    }
    // For non-production, include both CHATROOM_WEB_URL and CHATROOM_CONVEX_URL
    const webUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    return `CHATROOM_WEB_URL=${webUrl} \\\nCHATROOM_CONVEX_URL=${convexUrl} \\\nchatroom auth login`;
  }, [isProductionUrl]);

  // Memoize joined count
  const joinedCount = useMemo(
    () => teamRoles.filter((role) => participantMap.has(role.toLowerCase())).length,
    [teamRoles, participantMap]
  );

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6 pb-6 border-b-2 border-chatroom-border">
        <h2 className="flex items-center gap-2 text-lg font-bold uppercase tracking-widest text-chatroom-text-primary mb-2">
          <Rocket size={20} /> Setup Your Team
        </h2>
        <p className="text-sm text-chatroom-text-muted">
          {joinedCount} of {teamRoles.length} agents ready
        </p>
      </div>

      {/* Auth Login Section - shown for non-production */}
      {!isProductionUrl && (
        <div className="bg-chatroom-bg-surface border-2 border-chatroom-status-warning/30 mb-6">
          <div className="flex items-center gap-2 p-4 border-b border-chatroom-border">
            <Terminal size={16} className="text-chatroom-status-warning" />
            <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
              CLI Authentication
            </span>
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-chatroom-status-warning/15 text-chatroom-status-warning">
              Local Mode
            </span>
          </div>
          <div className="p-4">
            <p className="text-xs text-chatroom-text-muted mb-3">
              Authenticate agents with this local backend:
            </p>
            <div className="flex items-start gap-2 p-3 bg-chatroom-bg-primary">
              <pre className="font-mono text-xs text-chatroom-text-secondary flex-1 whitespace-pre-wrap">
                {authLoginCommand}
              </pre>
              <CopyButton
                text={authLoginCommand}
                label="Copy"
                copiedLabel="Copied!"
                variant="compact"
              />
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="bg-chatroom-bg-tertiary border-l-2 border-chatroom-status-info p-4 mb-6">
        <p className="text-sm text-chatroom-text-secondary">
          Use the <strong>Remote</strong> tab to start an agent on a connected machine, or the{' '}
          <strong>Custom</strong> tab to copy the prompt and paste it into your AI assistant
          manually.
        </p>
      </div>

      {/* Steps */}
      <div className="flex flex-col gap-4">
        {teamRoles.map((role, index) => {
          const isJoined = participantMap.has(role.toLowerCase());
          const prompt = generatePrompt(role);

          return (
            <SetupAgentCard
              key={role}
              role={role}
              index={index}
              isJoined={isJoined}
              prompt={prompt}
              chatroomId={chatroomId}
              connectedMachines={connectedMachines}
              agentConfigs={agentConfigs}
              isLoadingMachines={isLoadingMachines}
              daemonStartCommand={daemonStartCommand}
              sendCommand={sendCommand}
              onViewPrompt={onViewPrompt}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-6 pt-6 border-t-2 border-chatroom-border">
        <p className="flex items-center gap-2 text-xs text-chatroom-text-muted">
          <Lightbulb size={14} className="text-chatroom-status-warning" /> Tip: Use the Remote tab
          to start agents directly, or copy the prompt from the Custom tab
        </p>
      </div>
    </div>
  );
});
