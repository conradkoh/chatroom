'use client';

import { ArrowUp, ArrowDown, X } from 'lucide-react';
import { memo } from 'react';

import type { EnhancerConfigEntry } from '../types/enhancerConfigEntry';
import { buildEnhancerConfigKey } from '../types/enhancerConfigEntry';
import { formatEnhancerConfigLabel } from '../utils/formatEnhancerConfigLabel';

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
          <div
            key={buildEnhancerConfigKey(fav)}
            className="flex items-center gap-1 min-w-0 px-1.5 py-1 bg-chatroom-bg-tertiary border border-chatroom-border"
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => onApply(fav)}
              className="flex-1 min-w-0 text-left text-[11px] text-chatroom-text-primary hover:text-chatroom-accent disabled:opacity-50"
              title={formatEnhancerConfigLabel(fav)}
            >
              <span className="block truncate">
                <span className="text-chatroom-status-warning mr-1">★</span>
                {formatEnhancerConfigLabel(fav)}
              </span>
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onMoveFavorite(i, i - 1)}
              className="shrink-0 p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary disabled:opacity-30"
              title="Move up"
              aria-label="Move up"
            >
              <ArrowUp size={12} />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onMoveFavorite(i, i + 1)}
              className="shrink-0 p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary disabled:opacity-30"
              title="Move down"
              aria-label="Move down"
            >
              <ArrowDown size={12} />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemoveFavorite(fav)}
              className="shrink-0 p-0.5 text-chatroom-text-muted hover:text-chatroom-status-error disabled:opacity-30"
              title="Remove favorite"
              aria-label="Remove favorite"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
});
