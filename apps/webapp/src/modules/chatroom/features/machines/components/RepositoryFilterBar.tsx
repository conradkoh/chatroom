'use client';

import { Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';

export interface RepositoryFilterBarProps {
  value: string;
  onChange: (next: string) => void;
}

/** Filter input for the loaded snapshot. Escape clears a non-empty value. */
export function RepositoryFilterBar({ value, onChange }: RepositoryFilterBarProps) {
  return (
    <div className="relative">
      <Search
        size={14}
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-chatroom-text-muted"
      />
      <Input
        type="text"
        data-testid="ledger-filter"
        aria-label="Filter repositories"
        placeholder="Filter repositories…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value !== '') {
            event.preventDefault();
            onChange('');
          }
        }}
        className="pl-8 pr-8"
      />
      {value !== '' && (
        <button
          type="button"
          data-testid="ledger-filter-clear"
          aria-label="Clear filter"
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
