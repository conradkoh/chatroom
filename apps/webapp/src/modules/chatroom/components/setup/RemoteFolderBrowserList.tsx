// fallow-ignore-file unused-file unused-export
// Unwired until SetupFolderPickerField renders the browser; the field commit removes this marker.
'use client';

import type { FolderBrowseEntry } from '@workspace/shared/domain/folder-browse';
import { ChevronRight, Folder } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { emptyCopy, type EmptyCopy } from './remoteFolderBrowserCopy';

import type { RemoteFolderBrowserState } from '@/hooks/useRemoteFolderBrowser';

/** Body buttons (empty-state actions, error and session-end actions) share one style. */
export const BODY_BUTTON_CLASS_NAME =
  'inline-flex h-10 items-center justify-center border border-chatroom-border px-3 text-xs font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover sm:h-8';

const ROW_CLASS_NAME =
  'group flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary active:bg-chatroom-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-chatroom-accent transition-colors duration-75 sm:min-h-8';

const EMPTY_CLASS_NAME =
  'flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-chatroom-text-secondary';

/**
 * Where the arrow and Home/End keys move the roving focus, given the current row and the last
 * index. ArrowUp without Alt lands here; Alt+ArrowUp goes up a folder instead.
 */
const ROW_NAVIGATION = new Map<string, (current: number, last: number) => number>([
  ['ArrowDown', (current, last) => Math.min(current + 1, last)],
  ['ArrowUp', (current) => Math.max(current - 1, 0)],
  ['Home', () => 0],
  ['End', (_current, last) => last],
]);

/**
 * The roving index belongs to one folder. It is stored with that folder's path, so a navigation
 * resets it to the first row without an effect that sets state.
 */
interface ActiveRow {
  path: string;
  index: number;
}

function joinFolderPath(folder: string, name: string): string {
  return `${folder === '/' ? '' : folder}/${name}`;
}

/** One folder row. Its tabIndex comes from the list, which owns the roving focus. */
function FolderRow({
  entry,
  fullPath,
  active,
  buttonRef,
  onOpen,
}: {
  entry: FolderBrowseEntry;
  fullPath: string;
  active: boolean;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onOpen: (path: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        ref={buttonRef}
        data-path={entry.name}
        tabIndex={active ? 0 : -1}
        title={fullPath}
        onClick={() => onOpen(fullPath)}
        className={ROW_CLASS_NAME}
      >
        <Folder size={16} aria-hidden className="shrink-0 text-chatroom-accent" />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{entry.name}</span>
        {entry.symlink && (
          <span
            className="shrink-0 border border-chatroom-border px-1 text-[9px] font-bold uppercase tracking-wider text-chatroom-text-muted"
            title="Symbolic link to a folder"
          >
            Link
          </span>
        )}
        <ChevronRight
          size={14}
          aria-hidden
          className="shrink-0 text-chatroom-text-muted group-hover:text-chatroom-text-primary"
        />
      </button>
    </li>
  );
}

/** The centred message that replaces the rows, with its one action when it has one. */
function EmptyRows({
  copy,
  onClearFilter,
  onShowHidden,
}: {
  copy: EmptyCopy;
  onClearFilter: () => void;
  onShowHidden: () => void;
}) {
  return (
    <li className={EMPTY_CLASS_NAME}>
      <p>{copy.title}</p>
      {copy.body && <p>{copy.body}</p>}
      {copy.action === 'clear-filter' && (
        <button type="button" className={BODY_BUTTON_CLASS_NAME} onClick={onClearFilter}>
          Clear filter
        </button>
      )}
      {copy.action === 'show-hidden' && (
        <button type="button" className={BODY_BUTTON_CLASS_NAME} onClick={onShowHidden}>
          Show hidden
        </button>
      )}
    </li>
  );
}

/**
 * The folder rows of a ready listing, with roving focus. Not virtualized: the daemon caps a
 * listing at 500 entries. Rows stay on screen while a navigation is in flight.
 */
// fallow-ignore-next-line complexity
export function RemoteFolderBrowserList({ browser }: { browser: RemoteFolderBrowserState }) {
  const listing = browser.listing;
  const path = listing?.path ?? null;
  const [activeRow, setActiveRow] = useState<ActiveRow>({ path, index: 0 });
  const activeIndex = activeRow.path === path ? activeRow.index : 0;
  const listRef = useRef<HTMLUListElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Tracked by focus events, not read from document.activeElement: a row that navigated away is
  // removed from the DOM, which takes focus with it before any effect can look.
  const focusInListRef = useRef(false);

  // A new folder starts at its first row. Focus moves there only when focus was in the list.
  useEffect(() => {
    if (focusInListRef.current) rowRefs.current[0]?.focus();
  }, [path]);

  if (!listing) return null;

  const empty = emptyCopy({
    dirCount: listing.dirCount,
    fileCount: listing.fileCount,
    hiddenCount: listing.hiddenCount,
    filter: browser.filter,
    showHidden: browser.showHidden,
  });

  // fallow-ignore-next-line complexity
  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const goUp = event.key === 'Backspace' || (event.key === 'ArrowUp' && event.altKey);
    if (goUp) {
      if (listing.parentPath === null) return;
      event.preventDefault();
      browser.goUp();
      return;
    }
    const last = listing.entries.length - 1;
    const move = ROW_NAVIGATION.get(event.key);
    if (!move || last < 0) return;
    event.preventDefault();
    const next = move(activeIndex, last);
    setActiveRow({ path: listing.path, index: next });
    rowRefs.current[next]?.focus();
  };

  return (
    <ul
      ref={listRef}
      role="list"
      aria-label={`Folders in ${listing.path}`}
      aria-busy={browser.isNavigating}
      onKeyDown={handleKeyDown}
      onFocus={() => {
        focusInListRef.current = true;
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          focusInListRef.current = false;
        }
      }}
      className="relative h-full"
    >
      {browser.isNavigating && (
        <li
          aria-hidden="true"
          data-testid="remote-folder-browser-progress"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-chatroom-accent"
        />
      )}
      {empty ? (
        <EmptyRows
          copy={empty}
          onClearFilter={() => browser.setFilter('')}
          onShowHidden={() => browser.setShowHidden(true)}
        />
      ) : (
        listing.entries.map((entry, index) => (
          <FolderRow
            key={entry.name}
            entry={entry}
            fullPath={joinFolderPath(listing.path, entry.name)}
            active={index === activeIndex}
            buttonRef={(node) => {
              rowRefs.current[index] = node;
            }}
            onOpen={browser.navigate}
          />
        ))
      )}
    </ul>
  );
}
