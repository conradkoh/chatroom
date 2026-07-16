'use client';

import { ArrowUp, ArrowDown, Star, X, Plus } from 'lucide-react';
import { memo } from 'react';

import { getModelDisplayLabel, getHarnessDisplayName } from '../../types/machine';
import type { AgentHarness } from '../../types/machine';
import type { MachineConfigEntry } from '../../types/machineConfig';

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
  isFavorite: (entry: MachineConfigEntry) => boolean;
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
  isFavorite,
}: MachineConfigQuickPickProps) {
  const currentEntry: MachineConfigEntry | null =
    currentHarness && currentModel ? { agentHarness: currentHarness, model: currentModel } : null;

  const currentIsFavorite = currentEntry != null && isFavorite(currentEntry);

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
              <div
                key={`${fav.agentHarness}|${fav.model}`}
                className="flex items-center gap-1 px-1.5 py-1 bg-chatroom-bg-tertiary border border-chatroom-border"
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onApply(fav)}
                  className="flex-1 text-left text-[11px] text-chatroom-text-primary hover:text-chatroom-accent truncate disabled:opacity-50"
                  title={`${getHarnessDisplayName(fav.agentHarness)} / ${getModelDisplayLabel(fav.model)}`}
                >
                  <span className="text-chatroom-status-warning mr-1">★</span>
                  {getHarnessDisplayName(fav.agentHarness)} / {getModelDisplayLabel(fav.model)}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onMoveFavorite(i, i - 1)}
                  className="p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary disabled:opacity-30"
                  title="Move up"
                  aria-label="Move up"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onMoveFavorite(i, i + 1)}
                  className="p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary disabled:opacity-30"
                  title="Move down"
                  aria-label="Move down"
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemoveFavorite(fav)}
                  className="p-0.5 text-chatroom-text-muted hover:text-chatroom-status-error disabled:opacity-30"
                  title="Remove favorite"
                  aria-label="Remove favorite"
                >
                  <X size={12} />
                </button>
              </div>
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
              <div
                key={`rec-${rec.agentHarness}|${rec.model}`}
                className="flex items-center gap-1 px-1.5 py-1 bg-chatroom-bg-tertiary border border-chatroom-border"
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onApply(rec)}
                  className="flex-1 text-left text-[11px] text-chatroom-text-primary hover:text-chatroom-accent truncate disabled:opacity-50"
                  title={`${getHarnessDisplayName(rec.agentHarness)} / ${getModelDisplayLabel(rec.model)}`}
                >
                  {getHarnessDisplayName(rec.agentHarness)} / {getModelDisplayLabel(rec.model)}
                </button>
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
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toggle favorite for current selection */}
      {currentEntry != null && !currentIsFavorite && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onToggleFavorite(currentEntry)}
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-status-warning disabled:opacity-50"
        >
          <Plus size={12} />
          Add to Favorites
        </button>
      )}
    </div>
  );
});
