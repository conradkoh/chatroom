'use client';

import { memo } from 'react';

import { EnhancerConfigFavoritesList } from './EnhancerConfigFavoritesList';
import type { EnhancerConfigEntry } from '../types/enhancerConfigEntry';

interface EnhancerConfigQuickPickProps {
  favorites: EnhancerConfigEntry[];
  disabled?: boolean;
  onApply: (entry: EnhancerConfigEntry) => void;
  onRemoveFavorite: (entry: EnhancerConfigEntry) => void;
  onMoveFavorite: (fromIndex: number, toIndex: number) => void;
}

export const EnhancerConfigQuickPick = memo(function EnhancerConfigQuickPick({
  favorites,
  disabled = false,
  onApply,
  onRemoveFavorite,
  onMoveFavorite,
}: EnhancerConfigQuickPickProps) {
  if (favorites.length === 0) return null;

  return (
    <div className="space-y-2 px-3 pb-2" data-testid="enhancer-config-quick-pick">
      <EnhancerConfigFavoritesList
        favorites={favorites}
        disabled={disabled}
        onApply={onApply}
        onRemoveFavorite={onRemoveFavorite}
        onMoveFavorite={onMoveFavorite}
      />
    </div>
  );
});
