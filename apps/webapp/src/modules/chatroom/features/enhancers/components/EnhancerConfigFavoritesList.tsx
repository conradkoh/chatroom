'use client';

import { memo } from 'react';

import { ConfigFavoriteRowActions } from '../../../components/ConfigFavoriteRowActions';
import { HarnessModelConfigRow } from '../../../components/HarnessModelConfigRow';
import { getHarnessDisplayName, getModelDisplayLabel } from '../../../types/machine';
import type { EnhancerConfigEntry } from '../types/enhancerConfigEntry';
import { buildEnhancerConfigKey } from '../types/enhancerConfigEntry';

export interface EnhancerConfigFavoritesListProps {
  favorites: EnhancerConfigEntry[];
  disabled?: boolean;
  onApply: (entry: EnhancerConfigEntry) => void;
  onRemoveFavorite: (entry: EnhancerConfigEntry) => void;
  onMoveFavorite: (fromIndex: number, toIndex: number) => void;
}

export const EnhancerConfigFavoritesList = memo(function EnhancerConfigFavoritesList({
  favorites,
  disabled = false,
  onApply,
  onRemoveFavorite,
  onMoveFavorite,
}: EnhancerConfigFavoritesListProps) {
  if (favorites.length === 0) return null;

  return (
    <div data-testid="enhancer-config-favorites-list">
      <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted mb-1">
        Favorites
      </div>
      <div className="space-y-0.5">
        {favorites.map((fav, i) => (
          <HarnessModelConfigRow
            key={buildEnhancerConfigKey(fav)}
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
  );
});
