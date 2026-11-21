'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Loader2, Play, RefreshCw, Square } from 'lucide-react';
import React, { memo, useCallback, useRef, useState } from 'react';

import { StartWithFavoritesDialog } from '../features/machine-config/components/StartWithFavoritesDialog';
import { useStartAgentsWithFavorites } from '../features/machine-config/hooks/useStartAgentsWithFavorites';
import { useChatroomAgentOperations } from '../hooks/useChatroomAgentOperations';
import {
  describeAgentOperation,
  type FeedbackDraft,
  type ReportFeedback,
} from '../utils/describeAgentOperation';

type ChatroomId = Id<'chatroom_rooms'>;

interface ChatroomSidebarAgentActionsProps {
  chatroomId: string;
  canStop: boolean;
  showStart: boolean;
  isRunning: boolean;
  report: ReportFeedback;
}

interface AgentActionButtonsProps {
  canStop: boolean;
  showStart: boolean;
  isRunning: boolean;
  isSubmittingStop: boolean;
  isStarting: boolean;
  startTitle: string;
  isRestarting: boolean;
  onStop: (event: React.MouseEvent) => void;
  onStart: (event: React.MouseEvent) => void;
  onRestart: (event: React.MouseEvent) => void;
  startButtonRef: React.RefObject<HTMLButtonElement | null>;
}

async function stopAgentsAndCommands(
  chatroomId: ChatroomId,
  stopAgents: (id: ChatroomId) => Promise<unknown>,
  stopAllCommandRuns: (args: { chatroomId: ChatroomId }) => Promise<unknown>
): Promise<string[]> {
  const [agentStop, commandStop] = await Promise.allSettled([
    Promise.resolve().then(() => stopAgents(chatroomId)),
    Promise.resolve().then(() => stopAllCommandRuns({ chatroomId })),
  ]);
  return [
    agentStop.status === 'rejected' ? `Agents: ${String(agentStop.reason)}` : null,
    commandStop.status === 'rejected' ? `Command runs: ${String(commandStop.reason)}` : null,
  ].filter((failure): failure is string => failure !== null);
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
  startTitle,
  onStart,
  startButtonRef,
}: Pick<AgentActionButtonsProps, 'isStarting' | 'startTitle' | 'onStart' | 'startButtonRef'>) {
  return (
    <button
      ref={startButtonRef}
      onClick={onStart}
      title={startTitle}
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
  startTitle,
  isRestarting,
  onStop,
  onStart,
  onRestart,
  startButtonRef,
}: AgentActionButtonsProps) {
  return (
    <>
      {canStop && <StopButton isSubmittingStop={isSubmittingStop} onStop={onStop} />}
      {showStart && (
        <StartButton
          isStarting={isStarting}
          startTitle={startTitle}
          onStart={onStart}
          startButtonRef={startButtonRef}
        />
      )}
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

function stopFeedback(failures: string[]): FeedbackDraft | null {
  return failures.length > 0
    ? { tone: 'error', title: 'Failed to stop agents', items: failures }
    : null;
}

function runSidebarAgentAction(
  event: React.MouseEvent,
  setBusy: React.Dispatch<React.SetStateAction<boolean>>,
  report: ReportFeedback,
  action: () => Promise<FeedbackDraft | null>,
  fallbackMessage: string
) {
  event.stopPropagation();
  event.preventDefault();
  report(null);
  setBusy(true);
  return action()
    .then((draft) => report(draft))
    .catch((error) => {
      report({ tone: 'error', message: error instanceof Error ? error.message : fallbackMessage });
    })
    .finally(() => setBusy(false));
}

export const ChatroomSidebarAgentActions = memo(function ChatroomSidebarAgentActions({
  chatroomId,
  canStop,
  showStart,
  isRunning,
  report,
}: ChatroomSidebarAgentActionsProps) {
  const { startAgents, stopAgents, restartAgents } = useChatroomAgentOperations();
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const stopAllCommandRuns = useSessionMutation(api.commands.stopAllCommandRunsForChatroom);
  const [isSubmittingStop, setIsSubmittingStop] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const id = chatroomId as ChatroomId;

  // Runs after the favourites check resolves or is skipped. The controller does not catch errors, so this does.
  const start = useCallback(
    async ({ appliedCount }: { appliedCount: number }) => {
      try {
        report(describeAgentOperation(await startAgents(id), 'start', appliedCount));
      } catch (error) {
        report({
          tone: 'error',
          message: error instanceof Error ? error.message : 'Failed to start agents',
        });
      }
    },
    [id, report, startAgents]
  );
  const { phase, isBusy, requestStart, dialogProps } = useStartAgentsWithFavorites({
    chatroomId,
    start,
  });

  const handleStop = useCallback(
    (event: React.MouseEvent) =>
      runSidebarAgentAction(
        event,
        setIsSubmittingStop,
        report,
        async () => stopFeedback(await stopAgentsAndCommands(id, stopAgents, stopAllCommandRuns)),
        'Failed to stop agents'
      ),
    [id, report, stopAgents, stopAllCommandRuns]
  );

  const handleStart = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      report(null);
      requestStart();
    },
    [report, requestStart]
  );

  const handleRestart = useCallback(
    (event: React.MouseEvent) =>
      runSidebarAgentAction(
        event,
        setIsRestarting,
        report,
        async () => describeAgentOperation(await restartAgents(id), 'restart'),
        'Failed to restart agents'
      ),
    [id, report, restartAgents]
  );

  return (
    <>
      <AgentActionButtons
        canStop={canStop}
        showStart={showStart}
        isRunning={isRunning}
        isSubmittingStop={isSubmittingStop}
        isStarting={isBusy}
        startTitle={
          phase === 'checking' ? 'Checking favourite models…' : 'Start with last configuration'
        }
        isRestarting={isRestarting}
        onStop={handleStop}
        onStart={handleStart}
        onRestart={handleRestart}
        startButtonRef={startButtonRef}
      />
      <StartWithFavoritesDialog {...dialogProps} finalFocusRef={startButtonRef} />
    </>
  );
});
