'use client';

import type { KeyboardEvent, RefObject } from 'react';

import { ImportEntryRow, IMPORT_CHECKBOX_CLASS } from './ImportEntryRow';
import type { ImportViewState } from '../../hooks/useTransferImport';
import {
  IMPORT_NO_CHATROOMS_COPY,
  IMPORT_NOT_IMPORTABLE_HELP,
  pluralize,
} from '../../lib/transferCopy';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogFooter, DialogScrollBody } from '@/components/ui/dialog';
import { chatroomIndustrialDialogFooterClassName } from '@/modules/chatroom/components/shared/industrialDialogStyles';
import { formatTimestampFull } from '@/modules/chatroom/utils/chatroomTimestamp';

type ListedState = Extract<ImportViewState, { kind: 'listed' }>;

interface ImportSelectStepProps {
  state: ListedState;
  /** The locked target's display name, shown in the footer. */
  machineName: string;
  onToggle(key: string): void;
  onSelectAll(): void;
  onClear(): void;
  onStart(): void;
  onReset(): void;
  onClose(): void;
  /** Focused when the file has importable entries. */
  selectAllRef: RefObject<HTMLButtonElement | null>;
  /** Focused when nothing in the file can be imported. */
  chooseDifferentRef: RefObject<HTMLButtonElement | null>;
}

/** The select step: one header line, the entry list and the footer. */
// fallow-ignore-next-line complexity
export function ImportSelectStep({
  state,
  machineName,
  onToggle,
  onSelectAll,
  onClear,
  onStart,
  onReset,
  onClose,
  selectAllRef,
  chooseDifferentRef,
}: ImportSelectStepProps) {
  const { listing, selected, importedKeys } = state;
  const importable = listing.entries.filter(
    (entry) => entry.validity.ok && !importedKeys.has(entry.key)
  ).length;
  const invalid = listing.entries.length - importable;
  const selectedCount = selected.size;
  const allSelected = importable > 0 && selectedCount === importable;
  const someSelected = selectedCount > 0 && !allSelected;
  const canStart = importable > 0 && selectedCount > 0;

  return (
    <>
      <DialogScrollBody className="min-h-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            className="min-w-0 truncate font-mono text-[10px] text-chatroom-text-muted"
            title={state.fileName}
          >
            {state.fileName} · {listing.kind === 'bundle' ? 'Bundle' : 'Single chatroom'} · exported{' '}
            {formatTimestampFull(Date.parse(listing.exportedAt))}
          </p>
          <Button ref={chooseDifferentRef} variant="ghost" size="xs" onClick={onReset}>
            Choose different file
          </Button>
        </div>
        {listing.entries.length === 0 ? (
          <EmptyFile onReset={onReset} />
        ) : (
          <>
            <p className="text-xs text-chatroom-text-muted">
              {pluralize(listing.entries.length, 'chatroom')} · {invalid} not importable
            </p>
            <label className="flex items-center gap-2 border-b-2 border-chatroom-border pb-2 text-[10px] font-bold uppercase tracking-wider">
              <Checkbox
                ref={selectAllRef}
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                disabled={importable === 0}
                onCheckedChange={(checked) => (checked ? onSelectAll() : onClear())}
                className={IMPORT_CHECKBOX_CLASS}
                aria-label={`Select all ${importable} importable chatrooms`}
              />
              Select all ({importable} importable)
              <span className="ml-auto font-mono normal-case tabular-nums text-chatroom-text-muted">
                {selectedCount} selected
              </span>
            </label>
            <div
              role="group"
              aria-label="Chatrooms in this file"
              data-testid="import-entry-list"
              onKeyDown={(event) => onListKeyDown(event, onSelectAll)}
              className="divide-y divide-chatroom-border border border-chatroom-border"
            >
              {listing.entries.map((entry) => (
                <ImportEntryRow
                  key={entry.key}
                  entry={entry}
                  selected={selected.has(entry.key)}
                  imported={importedKeys.has(entry.key)}
                  onToggle={onToggle}
                />
              ))}
            </div>
          </>
        )}
      </DialogScrollBody>
      <DialogFooter className={chatroomIndustrialDialogFooterClassName}>
        <p id="import-disabled-reason" className="text-xs text-chatroom-text-muted sm:mr-auto">
          {disabledReason({
            importable,
            selectedCount,
            machineName,
            empty: listing.entries.length === 0,
          })}
        </p>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!canStart}
          aria-describedby="import-disabled-reason"
          data-testid="import-start"
          onClick={onStart}
        >
          Import {pluralize(selectedCount, 'chatroom')}
        </Button>
      </DialogFooter>
    </>
  );
}

function EmptyFile({ onReset }: { onReset(): void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-chatroom-text-muted">{IMPORT_NO_CHATROOMS_COPY}</p>
      <Button variant="secondary" size="sm" onClick={onReset}>
        Choose a different file
      </Button>
    </div>
  );
}

/** The footer line: what is selected and where it goes, or why Import is disabled. */
// fallow-ignore-next-line complexity
function disabledReason({
  importable,
  selectedCount,
  machineName,
  empty,
}: {
  importable: number;
  selectedCount: number;
  machineName: string;
  empty: boolean;
}): string {
  if (empty) return IMPORT_NO_CHATROOMS_COPY;
  if (importable === 0) return IMPORT_NOT_IMPORTABLE_HELP;
  if (selectedCount === 0) return 'Select at least one chatroom.';
  return `${selectedCount} of ${importable} selected → ${machineName}`;
}

const IMPORTABLE_CHECKBOX = '[data-slot="checkbox"]:not([data-disabled]):not([disabled])';

/** Arrow keys move between importable checkboxes; Ctrl/⌘+A selects them all. */
// fallow-ignore-next-line complexity
function onListKeyDown(event: KeyboardEvent<HTMLDivElement>, selectAll: () => void): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
    event.preventDefault();
    selectAll();
    return;
  }
  const target = navigationTarget(event, event.currentTarget);
  if (target === null) return;
  event.preventDefault();
  target.focus();
}

// fallow-ignore-next-line complexity
function navigationTarget(
  event: KeyboardEvent<HTMLDivElement>,
  list: HTMLElement
): HTMLElement | null {
  const key = event.key;
  if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return null;
  const items = Array.from(list.querySelectorAll<HTMLElement>(IMPORTABLE_CHECKBOX));
  if (items.length === 0) return null;
  const current = items.indexOf(document.activeElement as HTMLElement);
  if (key === 'Home') return items[0];
  if (key === 'End') return items[items.length - 1];
  if (key === 'ArrowUp') return items[Math.max(current - 1, 0)];
  return items[Math.min(current + 1, items.length - 1)];
}
