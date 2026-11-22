'use client';

import { Loader2, Star } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useChatroomWorkspace } from '../../../context/ChatroomWorkspaceContext';
import { useWorkspaceAgentDirectory } from '../../../hooks/useWorkspaceAgentQueries';
import { getCompactModelLabel } from '../../../types/machine';
import {
  useApplyTopFavoriteModels,
  type ApplyTopFavoritesTarget,
} from '../hooks/useApplyTopFavoriteModels';
import {
  describeApplyTopFavoritesResult,
  type ApplyTopFavoritesFeedback,
} from '../lib/topFavoriteModels';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ApplyTopFavoriteModelsButtonProps =
  | {
      /** Settings button. Its outcome renders beneath the button, in the same column. */
      variant: 'labelled';
    }
  | {
      /**
       * Compact sidebar toolbar button. The toolbar row cannot grow, so the outcome goes to the
       * caller, which renders `ApplyTopFavoritesFeedbackLine` below the row.
       */
      variant: 'icon';
      onFeedbackChange: (feedback: ApplyTopFavoritesFeedback | null) => void;
    };

const NO_FAVORITES_REASON =
  "No favourite models for this team on this machine. Star a model in an agent's model picker first.";

const FEEDBACK_BASE_CLASS = 'break-words text-[10px]';

/**
 * Inline outcome of the last apply. `error` is an action failure and uses `role="alert"`.
 * `success` is the persistent restart hint and uses `role="status"`. Renders nothing without an outcome.
 */
export function ApplyTopFavoritesFeedbackLine({
  feedback,
  className,
}: {
  feedback: ApplyTopFavoritesFeedback | null;
  className?: string;
}) {
  if (!feedback) return null;
  const isError = feedback.kind === 'error';
  return (
    <p
      role={isError ? 'alert' : 'status'}
      className={cn(
        FEEDBACK_BASE_CLASS,
        isError ? 'text-chatroom-status-error' : 'text-chatroom-text-muted',
        className
      )}
    >
      {feedback.message}
    </p>
  );
}

/**
 * Applies each role's top favourite model (favourites index 0) for the chatroom's active team,
 * on the active workspace. Reads team + workspace from context so every placement behaves the same.
 */
// fallow-ignore-next-line complexity
export function ApplyTopFavoriteModelsButton(props: ApplyTopFavoriteModelsButtonProps) {
  const { variant } = props;
  const { chatroomId } = useChatroomWorkspace();
  const { workspace, agents, isLoading: isLoadingDirectory } = useWorkspaceAgentDirectory();
  const roles = useMemo(() => agents.map((agent) => agent.role), [agents]);
  const teamId = agents[0]?.teamId ?? null;
  const machineId = workspace?.machineId ?? null;
  const workspaceId = workspace?._registryId ?? null;
  const workingDir = workspace?.workingDir ?? '';

  const target = useMemo<ApplyTopFavoritesTarget | null>(
    () =>
      machineId && workspaceId && teamId
        ? { chatroomId, workspaceId, machineId, workingDir, teamId, roles }
        : null,
    [chatroomId, workspaceId, machineId, workingDir, teamId, roles]
  );
  const { topFavorites, isLoading, isApplying, apply } = useApplyTopFavoriteModels(target);

  const disabledReason =
    isLoadingDirectory || isLoading
      ? 'Loading favourite models…'
      : !target
        ? 'No active workspace'
        : topFavorites.length === 0
          ? NO_FAVORITES_REASON
          : null;
  const disabled = disabledReason !== null || isApplying;
  const plan = topFavorites
    .map(({ role, entry }) => `${role} → ${getCompactModelLabel(entry.model)}`)
    .join(', ');
  const tooltip = disabledReason ?? `Apply top favourite model: ${plan}`;

  const [feedback, setFeedback] = useState<ApplyTopFavoritesFeedback | null>(null);
  // Labelled keeps the outcome locally. Icon hands it to the caller, which renders it below the toolbar row.
  const publishFeedback = (next: ApplyTopFavoritesFeedback | null) => {
    if (props.variant === 'icon') props.onFeedbackChange(next);
    else setFeedback(next);
  };

  const handleApply = async () => {
    publishFeedback(null); // the next action clears the previous outcome
    const result = await apply();
    if (!result) return;
    publishFeedback(describeApplyTopFavoritesResult(result));
  };

  if (variant === 'icon') {
    return (
      <span title={tooltip} className="inline-flex">
        <button
          type="button"
          onClick={handleApply}
          disabled={disabled}
          aria-busy={isApplying}
          aria-label="Apply top favourite models"
          data-testid="apply-top-favorite-models"
          className={cn(
            'w-5 h-5 flex items-center justify-center flex-shrink-0 rounded transition-colors disabled:pointer-events-none',
            disabled
              ? 'text-chatroom-text-muted opacity-40'
              : 'enabled:cursor-pointer text-chatroom-status-warning hover:bg-chatroom-status-warning/10'
          )}
        >
          {isApplying ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Star size={10} fill="currentColor" />
          )}
        </button>
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 flex-shrink-0">
      <span title={tooltip} className="inline-flex">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleApply}
          disabled={disabled}
          aria-busy={isApplying}
          data-testid="apply-top-favorite-models"
          className="gap-1.5 text-[10px] font-bold uppercase tracking-wider"
        >
          {isApplying ? <Loader2 size={12} className="animate-spin" /> : <Star size={12} />}
          {isApplying ? 'Applying…' : 'Apply top favourites'}
        </Button>
      </span>
      <p className="text-[10px] text-chatroom-text-muted text-right max-w-[16rem]">
        {disabledReason ?? 'Sets each agent to its top favourite model on this machine.'}
      </p>
      <ApplyTopFavoritesFeedbackLine feedback={feedback} className="max-w-[16rem] text-right" />
    </div>
  );
}
