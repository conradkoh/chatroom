'use client';

import { Plus, Star } from 'lucide-react';
import { memo } from 'react';

import { EnhancerConfigFavoritesList } from './EnhancerConfigFavoritesList';
import type { EnhancerConfigEntry } from '../types/enhancerConfigEntry';
import { formatEnhancerConfigLabel } from '../utils/formatEnhancerConfigLabel';

interface EnhancerConfigQuickPickProps {
  favorites: EnhancerConfigEntry[];
  currentEntry: EnhancerConfigEntry | null;
  disabled?: boolean;
  onApply: (entry: EnhancerConfigEntry) => void;
  onToggleFavorite: (entry: EnhancerConfigEntry) => void;
  onRemoveFavorite: (entry: EnhancerConfigEntry) => void;
  onMoveFavorite: (fromIndex: number, toIndex: number) => void;
  isFavorite: (entry: EnhancerConfigEntry) => boolean;
}

export const EnhancerConfigQuickPick = memo(function EnhancerConfigQuickPick({
  favorites,
  currentEntry,
  disabled = false,
  onApply,
  onToggleFavorite,
  onRemoveFavorite,
  onMoveFavorite,
  isFavorite,
}: EnhancerConfigQuickPickProps) {
  const currentIsFavorite = currentEntry != null && isFavorite(currentEntry);

  if (favorites.length === 0 && currentEntry == null) return null;

  return (
    <div className="space-y-2 px-3 pb-2" data-testid="enhancer-config-quick-pick">
      <EnhancerConfigFavoritesList
        favorites={favorites}
        disabled={disabled}
        onApply={onApply}
        onRemoveFavorite={onRemoveFavorite}
        onMoveFavorite={onMoveFavorite}
      />

      {currentEntry != null && !currentIsFavorite && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onToggleFavorite(currentEntry)}
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-status-warning disabled:opacity-50"
          title={formatEnhancerConfigLabel(currentEntry)}
        >
          <Plus size={12} />
          Add to Favorites
        </button>
      )}

      {currentEntry != null && currentIsFavorite && (
        <div className="flex items-center gap-1 text-[10px] text-chatroom-text-muted">
          <Star size={12} className="text-chatroom-status-warning" />
          Current config is favorited
        </div>
      )}
    </div>
  );
});
