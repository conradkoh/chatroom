// fallow-ignore-file unused-file unused-export
// Unwired until SetupFolderPickerField renders the browser; the field commit removes this marker.
'use client';

import { Eye, EyeOff, Search } from 'lucide-react';

import { countsLabel, hiddenToggleLabel } from './remoteFolderBrowserCopy';

import type { RemoteFolderBrowserState } from '@/hooks/useRemoteFolderBrowser';

const HIDDEN_TOGGLE_CLASS_NAME =
  'inline-flex h-10 shrink-0 items-center gap-2 border border-chatroom-border px-2 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover disabled:opacity-50 sm:h-8';

/** Shows or hides dot-entries. Its pressed state is the only visual cue, so it stays a toggle. */
// fallow-ignore-next-line complexity
function HiddenToggle({
  browser,
  disabled,
}: {
  browser: RemoteFolderBrowserState;
  disabled: boolean;
}) {
  const { showHidden } = browser;
  return (
    <button
      type="button"
      aria-pressed={showHidden}
      disabled={disabled}
      onClick={() => browser.setShowHidden(!showHidden)}
      className={`${HIDDEN_TOGGLE_CLASS_NAME} ${showHidden ? 'bg-chatroom-bg-hover' : ''}`}
    >
      {showHidden ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
      {hiddenToggleLabel(showHidden, browser.listing?.hiddenCount ?? 0)}
    </button>
  );
}

/**
 * Filter input, hidden toggle and counts. The filter is never a form field that submits: Enter
 * is prevented, so a host `<form>` cannot be submitted from here.
 */
// fallow-ignore-next-line complexity
export function RemoteFolderBrowserToolbar({ browser }: { browser: RemoteFolderBrowserState }) {
  const disabled = browser.phase === 'ended' || browser.listing === null;
  const counts = browser.listing
    ? countsLabel(browser.listing.dirCount, browser.listing.fileCount)
    : null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-chatroom-border px-2 py-2">
      <label className="relative min-w-0 basis-full sm:flex-1 sm:basis-auto">
        <Search
          size={14}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-chatroom-text-muted"
        />
        <input
          type="text"
          aria-label="Filter folders"
          placeholder="Filter folders"
          maxLength={128}
          value={browser.filter}
          disabled={disabled}
          onChange={(event) => browser.setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
          className="h-10 w-full min-w-0 border border-chatroom-border bg-chatroom-bg-tertiary pl-7 pr-2 text-xs font-mono text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent disabled:opacity-50 sm:h-8"
        />
      </label>
      <HiddenToggle browser={browser} disabled={disabled} />
      <p className="text-[10px] font-mono tabular-nums text-chatroom-text-muted">
        {counts ? counts.folders : '—'}
        {counts && <span className="hidden sm:inline"> · {counts.files}</span>}
      </p>
    </div>
  );
}
