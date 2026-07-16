'use client';

import { ArrowUp, ArrowDown, Plus, X, Star } from 'lucide-react';
import { memo } from 'react';

import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';
import type { SearchConfigEntry } from '../types/searchConfig';
import { formatSearchConfigLabel } from '../utils/formatSearchConfigLabel';

export interface SearchConfigQuickPickProps {
  favorites: SearchConfigEntry[];
  harnesses: HarnessOption[];
  currentEntry: SearchConfigEntry | null;
  disabled?: boolean;
  onApply: (entry: SearchConfigEntry) => void;
  onAddFavorite: (entry: SearchConfigEntry) => void;
  onRemoveFavorite: (entry: SearchConfigEntry) => void;
  onMoveFavorite: (fromIndex: number, toIndex: number) => void;
  isFavorite: (entry: SearchConfigEntry) => boolean;
}

export const SearchConfigQuickPick = memo(function SearchConfigQuickPick({
  favorites,
  harnesses,
  currentEntry,
  disabled = false,
  onApply,
  onAddFavorite,
  onRemoveFavorite,
  onMoveFavorite,
  isFavorite,
}: SearchConfigQuickPickProps) {
  const currentIsFavorite = currentEntry != null && isFavorite(currentEntry);

  if (favorites.length === 0 && !currentEntry) return null;

  return (
    <div className="space-y-2" data-testid="search-config-quick-pick">
      {favorites.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted mb-1">
            Favorites
          </div>
          <div className="space-y-0.5">
            {favorites.map((fav, i) => (
              <div
                key={`${fav.harnessName}|${fav.modelKey}`}
                className="flex items-center gap-1 px-1.5 py-1 bg-chatroom-bg-tertiary border border-chatroom-border"
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onApply(fav)}
                  className="flex-1 text-left text-[11px] text-chatroom-text-primary hover:text-chatroom-accent truncate disabled:opacity-50"
                  title={formatSearchConfigLabel(fav, harnesses)}
                >
                  <span className="text-chatroom-status-warning mr-1">★</span>
                  {formatSearchConfigLabel(fav, harnesses)}
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

      {currentEntry != null && !currentIsFavorite && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAddFavorite(currentEntry)}
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-status-warning disabled:opacity-50"
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
