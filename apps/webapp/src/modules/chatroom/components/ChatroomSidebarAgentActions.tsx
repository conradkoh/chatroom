'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Loader2, Play, RefreshCw, Square } from 'lucide-react';
import React, { memo, useCallback, useState } from 'react';
import { toast } from 'sonner';

import { useChatroomAgentOperations } from '../hooks/useChatroomAgentOperations';

type ChatroomId = Id<'chatroom_rooms'>;
type AgentOperationResult = {
  failed: readonly unknown[];
  requested: readonly unknown[];
  skipped: readonly unknown[];
};

interface ChatroomSidebarAgentActionsProps {
  chatroomId: string;
  canStop: boolean;
  showStart: boolean;
  isRunning: boolean;
}

interface AgentActionButtonsProps {
  canStop: boolean;
  showStart: boolean;
  isRunning: boolean;
  isSubmittingStop: boolean;
  isStarting: boolean;
  isRestarting: boolean;
  onStop: (event: React.MouseEvent) => void;
  onStart: (event: React.MouseEvent) => void;
  onRestart: (event: React.MouseEvent) => void;
}

function reportAgentOperation(result: AgentOperationResult, operation: 'start' | 'restart') {
  if (result.failed.length > 0) {
    toast.error(`Failed to ${operation} ${result.failed.length} agent(s)`);
  } else if (result.requested.length > 0) {
    toast.success(
      `${operation[0].toUpperCase()}${operation.slice(1)} requested for ${result.requested.length} agent(s)`
    );
  } else {
    toast.error('No saved configuration is available for the permanent agents');
  }
}

async function stopAgentsAndCommands(
  chatroomId: ChatroomId,
  stopAgents: (id: ChatroomId) => Promise<unknown>,
  stopAllCommandRuns: (args: { chatroomId: ChatroomId }) => Promise<unknown>
) {
  const [agentStop, commandStop] = await Promise.allSettled([
    Promise.resolve().then(() => stopAgents(chatroomId)),
    Promise.resolve().then(() => stopAllCommandRuns({ chatroomId })),
  ]);
  return [
    agentStop.status === 'rejected' ? `Agents: ${String(agentStop.reason)}` : null,
    commandStop.status === 'rejected' ? `Command runs: ${String(commandStop.reason)}` : null,
  ].filter(Boolean);
}

function StopButton({
  isSubmittingStop,
  onStop,
}: Pick<AgentActionButtonsProps, 'isSubmittingStop' | 'onStop'>) {
  return (
    <button
      onClick={onStop}
      title="Stop agents and command runs"
      aria-label="Stop agents and command runs"
      aria-busy={isSubmittingStop}
      type="button"
      disabled={isSubmittingStop}
      className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
    >
      <Square size={8} fill="currentColor" />
    </button>
  );
}

function StartButton({
  isStarting,
  onStart,
}: Pick<AgentActionButtonsProps, 'isStarting' | 'onStart'>) {
  return (
    <button
      onClick={onStart}
      title="Start with last configuration"
      aria-label="Start agents"
      aria-busy={isStarting}
      disabled={isStarting}
      className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-50 disabled:pointer-events-none"
    >
      {isStarting ? (
        <Loader2 size={10} className="animate-spin" />
      ) : (
        <Play size={10} fill="currentColor" />
      )}
    </button>
  );
}

function RestartButton({
  isRestarting,
  isSubmittingStop,
  onRestart,
}: Pick<AgentActionButtonsProps, 'isRestarting' | 'isSubmittingStop' | 'onRestart'>) {
  return (
    <button
      onClick={onRestart}
      title="Restart agents"
      aria-label="Restart agents"
      aria-busy={isRestarting}
      type="button"
      disabled={isRestarting || isSubmittingStop}
      className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-50 disabled:pointer-events-none"
    >
      {isRestarting ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
    </button>
  );
}

function AgentActionButtons({
  canStop,
  showStart,
  isRunning,
  isSubmittingStop,
  isStarting,
  isRestarting,
  onStop,
  onStart,
  onRestart,
}: AgentActionButtonsProps) {
  return (
    <>
      {canStop && <StopButton isSubmittingStop={isSubmittingStop} onStop={onStop} />}
      {showStart && <StartButton isStarting={isStarting} onStart={onStart} />}
      {isRunning && (
        <RestartButton
          isRestarting={isRestarting}
          isSubmittingStop={isSubmittingStop}
          onRestart={onRestart}
        />
      )}
    </>
  );
}

function runSidebarAgentAction(
  event: React.MouseEvent,
  setBusy: React.Dispatch<React.SetStateAction<boolean>>,
  action: () => Promise<void>,
  fallbackMessage: string
) {
  event.stopPropagation();
  event.preventDefault();
  setBusy(true);
  return action()
    .catch((error) => {
      toast.error(error instanceof Error ? error.message : fallbackMessage);
    })
    .finally(() => setBusy(false));
}

export const ChatroomSidebarAgentActions = memo(function ChatroomSidebarAgentActions({
  chatroomId,
  canStop,
  showStart,
  isRunning,
}: ChatroomSidebarAgentActionsProps) {
  const { startAgents, stopAgents, restartAgents } = useChatroomAgentOperations();
  const stopAllCommandRuns = useSessionMutation(api.commands.stopAllCommandRunsForChatroom);
  const [isSubmittingStop, setIsSubmittingStop] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const id = chatroomId as ChatroomId;

  const handleStop = useCallback(
    (event: React.MouseEvent) =>
      runSidebarAgentAction(
        event,
        setIsSubmittingStop,
        async () => {
          const failures = await stopAgentsAndCommands(id, stopAgents, stopAllCommandRuns);
          if (failures.length > 0) toast.error(failures.join('; '));
        },
        'Failed to stop agents'
      ),
    [id, stopAgents, stopAllCommandRuns]
  );

  const handleStart = useCallback(
    (event: React.MouseEvent) =>
      runSidebarAgentAction(
        event,
        setIsStarting,
        async () => reportAgentOperation(await startAgents(id), 'start'),
        'Failed to start agents'
      ),
    [id, startAgents]
  );

  const handleRestart = useCallback(
    (event: React.MouseEvent) =>
      runSidebarAgentAction(
        event,
        setIsRestarting,
        async () => reportAgentOperation(await restartAgents(id), 'restart'),
        'Failed to restart agents'
      ),
    [id, restartAgents]
  );

  return (
    <AgentActionButtons
      canStop={canStop}
      showStart={showStart}
      isRunning={isRunning}
      isSubmittingStop={isSubmittingStop}
      isStarting={isStarting}
      isRestarting={isRestarting}
      onStop={handleStop}
      onStart={handleStart}
      onRestart={handleRestart}
    />
  );
});
