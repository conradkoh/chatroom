'use client';

import { memo } from 'react';

import type { SearchConfigEntry } from '../types/searchConfig';
import {
  getSearchConfigHarnessLabel,
  getSearchConfigModelLabel,
} from '../utils/formatSearchConfigLabel';

import { ConfigFavoriteRowActions } from '@/modules/chatroom/components/ConfigFavoriteRowActions';
import { HarnessModelConfigRow } from '@/modules/chatroom/components/HarnessModelConfigRow';
import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';

export interface SearchConfigFavoritesListProps {
  favorites: SearchConfigEntry[];
  harnesses: HarnessOption[];
  disabled?: boolean;
  onApply: (entry: SearchConfigEntry) => void;
  onRemoveFavorite: (entry: SearchConfigEntry) => void;
  onMoveFavorite: (fromIndex: number, toIndex: number) => void;
}

export const SearchConfigFavoritesList = memo(function SearchConfigFavoritesList({
  favorites,
  harnesses,
  disabled = false,
  onApply,
  onRemoveFavorite,
  onMoveFavorite,
}: SearchConfigFavoritesListProps) {
  if (favorites.length === 0) return null;

  return (
    <div data-testid="search-config-favorites-list">
      <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted mb-1">
        Favorites
      </div>
      <div className="space-y-0.5">
        {favorites.map((fav, i) => (
          <HarnessModelConfigRow
            key={`${fav.harnessName}|${fav.modelKey}`}
            harnessLabel={getSearchConfigHarnessLabel(fav, harnesses)}
            modelLabel={getSearchConfigModelLabel(fav, harnesses)}
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
