'use client';

import { Check, ChevronDown, Star } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';
import {
  ResponsivePickerShell,
  PickerSearch,
  PickerScrollBody,
  usePickerSearchState,
} from '@/modules/chatroom/components/picker';
import { cn } from '@/lib/utils';
import type { SearchConfigEntry } from '../types/searchConfig';
import { formatSearchConfigLabel } from '../utils/formatSearchConfigLabel';

export interface SearchConfigFavoriteDropdownProps {
  favorites: SearchConfigEntry[];
  harnesses: HarnessOption[];
  currentEntry: SearchConfigEntry | null;
  disabled?: boolean;
  onApply: (entry: SearchConfigEntry) => void;
  isFavorite: (entry: SearchConfigEntry) => boolean;
}

function entryKey(entry: SearchConfigEntry): string {
  return `${entry.harnessName}|${entry.modelKey}`;
}

export const SearchConfigFavoriteDropdown = memo(function SearchConfigFavoriteDropdown({
  favorites,
  harnesses,
  currentEntry,
  disabled = false,
  onApply,
  isFavorite,
}: SearchConfigFavoriteDropdownProps) {
  const [open, setOpen] = useState(false);
  const { searchTerm, setSearchTerm, handleOpenChange } = usePickerSearchState(setOpen);

  const summaryLabel = currentEntry
    ? formatSearchConfigLabel(currentEntry, harnesses)
    : 'Select config';

  const options = useMemo(() => {
    const items: Array<{ entry: SearchConfigEntry; isFav: boolean }> = favorites.map((entry) => ({
      entry,
      isFav: true,
    }));
    if (currentEntry && !isFavorite(currentEntry)) {
      items.unshift({ entry: currentEntry, isFav: false });
    }
    return items;
  }, [favorites, currentEntry, isFavorite]);

  const currentKey = currentEntry ? entryKey(currentEntry) : null;

  return (
    <ResponsivePickerShell
      open={open}
      onOpenChange={handleOpenChange}
      disabled={disabled}
      title="Switch config"
      align="start"
      contentClassName="w-72"
      trigger={
        <button
          type="button"
          disabled={disabled}
          className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[11px] text-chatroom-text-primary px-2 py-1.5 h-auto hover:border-chatroom-border-strong focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between min-w-0"
          title={summaryLabel}
        >
          <span className="truncate text-left flex-1">{summaryLabel}</span>
          <ChevronDown size={10} className="ml-1 shrink-0 text-chatroom-text-muted" />
        </button>
      }
    >
      <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search configs…" />
      <PickerScrollBody maxHeightClassName="max-h-60">
        {options.length === 0 ? (
          <p className="px-3 py-2 text-xs text-chatroom-text-muted">No configs found.</p>
        ) : (
          options.map(({ entry, isFav }) => {
            const key = entryKey(entry);
            const isActive = currentKey === key;
            const label = formatSearchConfigLabel(entry, harnesses);
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onApply(entry);
                  handleOpenChange(false);
                }}
                className={cn(
                  'w-full text-left px-3 py-2 border-b border-chatroom-border last:border-b-0 transition-colors flex items-center justify-between gap-2',
                  isActive ? 'bg-chatroom-accent/5' : 'hover:bg-chatroom-bg-hover'
                )}
              >
                <span className="truncate text-[11px] text-chatroom-text-primary min-w-0">
                  {isFav ? (
                    <Star size={10} className="inline mr-1 text-chatroom-status-warning shrink-0" />
                  ) : null}
                  {label}
                </span>
                {isActive ? <Check size={12} className="text-chatroom-accent shrink-0" /> : null}
              </button>
            );
          })
        )}
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
});
