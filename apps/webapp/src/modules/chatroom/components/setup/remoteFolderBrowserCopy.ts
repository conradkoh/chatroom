/**
 * Pure view derivations and exact copy for the remote folder browser.
 *
 * No React and no Convex here: every function takes `RemoteFolderBrowserState` (or plain values)
 * and returns strings or models, so the wording and the precedence rules are unit-tested without
 * a DOM. The components in this folder only lay these results out.
 */
import { FOLDER_BROWSE_NO_RESPONSE_MS } from '@workspace/shared/domain/folder-browse';

import type {
  RemoteFolderBrowserErrorCode,
  RemoteFolderBrowserState,
} from '@/hooks/useRemoteFolderBrowser';

export type BrowserBodyKind = 'loading' | 'list' | 'error' | 'no-response' | 'ended';
export type NoticeTone = 'error' | 'warning' | 'info';

/** One breadcrumb. The collapsed marker is `{ label: '…', path: '' }` and is not interactive. */
export interface BreadcrumbSegment {
  label: string;
  path: string;
}

export interface NoticeModel {
  tone: NoticeTone;
  message: string;
  action: 'retry' | null;
  actionLabel: string | null;
}

/** Seconds the UI waits before it reports `no-response`. Derived, so the copy cannot drift. */
export const NO_RESPONSE_SECONDS = FOLDER_BROWSE_NO_RESPONSE_MS / 1000;

/** Breadcrumbs longer than this collapse their middle into an ellipsis. */
const MAX_VISIBLE_CRUMBS = 4;

/** `1 folder` / `2 folders`. */
function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Root plus one crumb per segment; past four crumbs the middle collapses to `…`. */
export function breadcrumbSegments(path: string): BreadcrumbSegment[] {
  const names = path === '/' ? [] : path.split('/').filter((segment) => segment.length > 0);
  const root: BreadcrumbSegment = { label: '/', path: '/' };
  const named = names.map((name, index) => ({
    label: name,
    path: `/${names.slice(0, index + 1).join('/')}`,
  }));
  const segments = [root, ...named];
  if (segments.length <= MAX_VISIBLE_CRUMBS) return segments;
  return [root, { label: '…', path: '' }, ...named.slice(-2)];
}

/** Which body the panel renders. The ended phase and an absent listing decide it, in that order. */
// fallow-ignore-next-line complexity
export function bodyKindOf(browser: RemoteFolderBrowserState): BrowserBodyKind {
  if (browser.phase === 'ended') return 'ended';
  if (browser.phase === 'error') return browser.listing ? 'list' : 'error';
  if (browser.phase === 'no-response') return browser.listing ? 'list' : 'no-response';
  if (browser.phase === 'opening' || browser.phase === 'loading') return 'loading';
  return browser.listing ? 'list' : 'loading';
}

/**
 * Why Select is disabled, or null when it is enabled. The first matching rule wins:
 * ended, then no listing, then no-response with a listing (before isNavigating, which is also
 * true there), then navigating, then the root and non-selectable folder rules.
 */
// fallow-ignore-next-line complexity
export function selectDisabledReason(
  browser: RemoteFolderBrowserState,
  machineName: string
): string | null {
  const { phase, listing, isNavigating } = browser;
  if (phase === 'ended') return 'This session ended. Reopen to choose a folder.';
  if (listing === null) {
    if (phase === 'no-response') return `No response from ${machineName}. Try again.`;
    if (phase === 'error') return 'This folder could not be read. Try again or type a path.';
    return 'Loading folders…';
  }
  if (phase === 'no-response')
    return `No response from ${machineName}. Try again to choose a folder.`;
  if (isNavigating) return `Loading ${listing.path}…`;
  if (!listing.selectable && listing.path === '/') {
    return "The root folder can't be a workspace. Open a folder inside it.";
  }
  if (!listing.selectable) {
    return "This folder can't be used as a workspace. Open a subfolder or choose another folder.";
  }
  return null;
}

/** The message for a browse failure, naming the folder where there is one to name. */
// fallow-ignore-next-line complexity
export function errorCopy(
  error: { code: RemoteFolderBrowserErrorCode; path: string },
  machineName: string
): string {
  switch (error.code) {
    case 'PERMISSION_DENIED':
      return `Permission denied for ${error.path}. Choose another folder.`;
    case 'TIMEOUT':
      return `Reading ${error.path} took too long. Try again.`;
    case 'UNSUPPORTED_PLATFORM':
      return `Folder browsing is not available on ${machineName}. Type the folder path instead.`;
    case 'INVALID_PATH':
      return "That path isn't valid. Use an absolute path without '..'.";
    case 'READ_FAILED':
      return `Could not read ${error.path}. Try again or choose another folder.`;
  }
}

/** Label of the hidden-items toggle. The count is shown only while hidden items are hidden. */
export function hiddenToggleLabel(showHidden: boolean, hiddenCount: number): string {
  if (showHidden) return 'Hide hidden';
  if (hiddenCount > 0) return `Show hidden · ${hiddenCount}`;
  return 'Show hidden';
}

/** Folder and file counts for the toolbar. Files are hidden below `sm` by the caller. */
export function countsLabel(
  dirCount: number,
  fileCount: number
): { folders: string; files: string } {
  return {
    folders: countLabel(dirCount, 'folder', 'folders'),
    files: countLabel(fileCount, 'file', 'files'),
  };
}

/** Copy for an empty list: a title, an optional body, and at most one action. */
export interface EmptyCopy {
  title: string;
  body?: string;
  action: 'clear-filter' | 'show-hidden' | null;
}

/**
 * Copy for an empty list, or null when rows exist. The variants are checked in order:
 * A (a filter matches nothing), B (an empty folder), C (only hidden items, still hidden),
 * D (files but no subfolders).
 */
// fallow-ignore-next-line complexity
export function emptyCopy(args: {
  dirCount: number;
  fileCount: number;
  hiddenCount: number;
  filter: string;
  showHidden: boolean;
}): EmptyCopy | null {
  if (args.filter !== '' && args.dirCount === 0) {
    return { title: `No folders match “${args.filter}”.`, action: 'clear-filter' };
  }
  if (args.dirCount === 0 && args.fileCount === 0 && args.hiddenCount === 0) {
    return {
      title: 'No subfolders here.',
      body: 'Select this folder, or go up one level.',
      action: null,
    };
  }
  if (args.dirCount === 0 && args.hiddenCount > 0 && !args.showHidden) {
    return {
      title: `No visible subfolders. ${args.hiddenCount} hidden items.`,
      action: 'show-hidden',
    };
  }
  if (args.dirCount === 0 && args.fileCount > 0) {
    return { title: `No subfolders. This folder has ${args.fileCount} files.`, action: null };
  }
  return null;
}

/**
 * Inline notices, in display order: error, no-response, fellBack, incomplete scan, truncation.
 * Nothing is shown for an ended session, because the ended body and its Reopen replace it.
 */
// fallow-ignore-next-line complexity
export function noticeCopy(browser: RemoteFolderBrowserState): NoticeModel[] {
  const kind = bodyKindOf(browser);
  if (kind === 'ended') return [];
  const machine = browser.machineDisplayName ?? 'machine';
  const notices: NoticeModel[] = [];
  if (kind === 'list' && browser.error) {
    notices.push({
      tone: 'error',
      message: errorCopy(browser.error, machine),
      action: 'retry',
      actionLabel: 'Retry',
    });
  }
  if (kind === 'list' && browser.phase === 'no-response') {
    notices.push({
      tone: 'error',
      message: `${machine} did not answer within ${NO_RESPONSE_SECONDS} seconds. The folder list may be out of date.`,
      action: 'retry',
      actionLabel: 'Try again',
    });
  }
  const listing = browser.listing;
  if (listing?.fellBack && listing.requestedPath !== null) {
    notices.push({
      tone: 'info',
      message: `${listing.requestedPath} does not exist. Showing ${listing.path}, the nearest folder that does.`,
      action: null,
      actionLabel: null,
    });
  }
  if (listing?.complete === false) {
    notices.push({
      tone: 'warning',
      message:
        'The scan stopped early, so some folders may be missing. Filter only searches folders already scanned; type a full path to open one directly.',
      action: null,
      actionLabel: null,
    });
  }
  if (listing?.truncated) {
    notices.push({
      tone: 'warning',
      message: `Showing the first ${listing.entries.length} of ${listing.dirCount} folders. Type in Filter to narrow the list.`,
      action: null,
      actionLabel: null,
    });
  }
  return notices;
}

/** Text for the polite live region: announces navigation and the shown folder, never the body. */
// fallow-ignore-next-line complexity
export function liveRegionText(browser: RemoteFolderBrowserState): string {
  const { listing } = browser;
  if (!listing) return '';
  const kind = bodyKindOf(browser);
  if (kind === 'ended') return '';
  if (browser.isNavigating) return `Loading ${listing.path}`;
  if (kind === 'list') {
    return `Showing ${listing.path}, ${countLabel(listing.dirCount, 'folder', 'folders')}`;
  }
  return '';
}
