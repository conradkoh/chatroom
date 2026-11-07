'use client';

// fallow-ignore-file unused-file
// Wired into the UI in the follow-up slice; remove this suppression once the button is placed.

import { Loader2, Star } from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';

import { useChatroomWorkspace } from '../../../context/ChatroomWorkspaceContext';
import { useWorkspaceAgentDirectory } from '../../../hooks/useWorkspaceAgentQueries';
import { getCompactModelLabel } from '../../../types/machine';
import {
  useApplyTopFavoriteModels,
  type ApplyTopFavoritesTarget,
} from '../hooks/useApplyTopFavoriteModels';
import { describeApplyTopFavoritesResult } from '../lib/topFavoriteModels';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ApplyTopFavoriteModelsButtonProps {
  /** `icon`: compact sidebar toolbar button. `labelled`: settings button with helper text. */
  variant: 'icon' | 'labelled';
}

const NO_FAVORITES_REASON =
  "No favourite models for this team on this machine. Star a model in an agent's model picker first.";

/**
 * Applies each role's top favourite model (favourites index 0) for the chatroom's active team,
 * on the active workspace. Reads team + workspace from context so every placement behaves the same.
 */
// fallow-ignore-next-line complexity
export function ApplyTopFavoriteModelsButton({ variant }: ApplyTopFavoriteModelsButtonProps) {
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

  const handleApply = async () => {
    const result = await apply();
    if (!result) return;
    const feedback = describeApplyTopFavoritesResult(result);
    if (feedback.kind === 'success') toast.success(feedback.message);
    else toast.error(feedback.message);
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
    </div>
  );
}
