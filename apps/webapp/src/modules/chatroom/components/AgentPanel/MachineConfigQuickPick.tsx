'use client';

import { Star, X } from 'lucide-react';
import { memo } from 'react';

import type { MachineConfigEntry } from '../../features/machine-config/types/machineConfig';
import { getModelDisplayLabel, getHarnessDisplayName } from '../../types/machine';
import type { AgentHarness } from '../../types/machine';
import { ConfigFavoriteRowActions } from '../ConfigFavoriteRowActions';
import { HarnessModelConfigRow } from '../HarnessModelConfigRow';

interface MachineConfigQuickPickProps {
  favorites: MachineConfigEntry[];
  recommended: MachineConfigEntry[];
  currentHarness: AgentHarness | null;
  currentModel: string | null;
  disabled?: boolean;
  onApply: (entry: MachineConfigEntry) => void;
  onToggleFavorite: (entry: MachineConfigEntry) => void;
  onRemoveFavorite: (entry: MachineConfigEntry) => void;
  onMoveFavorite: (fromIndex: number, toIndex: number) => void;
  onDismissRecommended: (entry: MachineConfigEntry) => void;
}

// fallow-ignore-next-line complexity
export const MachineConfigQuickPick = memo(function MachineConfigQuickPick({
  favorites,
  recommended,
  currentHarness,
  currentModel,
  disabled = false,
  onApply,
  onToggleFavorite,
  onRemoveFavorite,
  onMoveFavorite,
  onDismissRecommended,
}: MachineConfigQuickPickProps) {
  const currentEntry: MachineConfigEntry | null =
    currentHarness && currentModel ? { agentHarness: currentHarness, model: currentModel } : null;

  if (favorites.length === 0 && recommended.length === 0 && currentEntry == null) return null;

  return (
    <div className="space-y-2" data-testid="machine-config-quick-pick">
      {/* Favorites */}
      {favorites.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted mb-1">
            Favorites
          </div>
          <div className="space-y-0.5">
            {favorites.map((fav, i) => (
              <HarnessModelConfigRow
                key={`${fav.agentHarness}|${fav.model}`}
                harnessLabel={getHarnessDisplayName(fav.agentHarness)}
                modelLabel={getModelDisplayLabel(fav.model)}
                starred
                disabled={disabled}
                onApply={() => onApply(fav)}
                actions={
                  <ConfigFavoriteRowActions
                    disabled={disabled}
                    onMoveUp={() => onMoveFavorite(i, i - 1)}
                    onMoveDown={() => onMoveFavorite(i, i + 1)}
                    onRemove={() => onRemoveFavorite(fav)}
                  />
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Recommended */}
      {recommended.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted mb-1">
            Recommended
          </div>
          <div className="space-y-0.5">
            {recommended.map((rec) => (
              <HarnessModelConfigRow
                key={`rec-${rec.agentHarness}|${rec.model}`}
                harnessLabel={getHarnessDisplayName(rec.agentHarness)}
                modelLabel={getModelDisplayLabel(rec.model)}
                disabled={disabled}
                onApply={() => onApply(rec)}
                actions={
                  <>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onToggleFavorite(rec)}
                      className="p-0.5 text-chatroom-text-muted hover:text-chatroom-status-warning disabled:opacity-30"
                      title="Add to favorites"
                      aria-label="Add to favorites"
                    >
                      <Star size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onDismissRecommended(rec)}
                      className="p-0.5 text-chatroom-text-muted hover:text-chatroom-status-error disabled:opacity-30"
                      title="Dismiss"
                      aria-label="Dismiss"
                    >
                      <X size={12} />
                    </button>
                  </>
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
