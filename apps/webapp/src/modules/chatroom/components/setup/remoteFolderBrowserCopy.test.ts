import { describe, expect, it } from 'vitest';

import {
  bodyKindOf,
  breadcrumbSegments,
  countsLabel,
  emptyCopy,
  errorCopy,
  hiddenToggleLabel,
  liveRegionText,
  noticeCopy,
  selectDisabledReason,
} from './remoteFolderBrowserCopy';

import type {
  RemoteFolderBrowserListing,
  RemoteFolderBrowserState,
} from '@/hooks/useRemoteFolderBrowser';

const noop = () => undefined;

const LISTING: RemoteFolderBrowserListing = {
  path: '/srv/app',
  parentPath: '/srv',
  requestedPath: '/srv/app',
  entries: [{ name: 'alpha' }],
  dirCount: 1,
  fileCount: 0,
  hiddenCount: 0,
  truncated: false,
  complete: true,
  selectable: true,
  fellBack: false,
};

function makeBrowser(overrides: Partial<RemoteFolderBrowserState> = {}): RemoteFolderBrowserState {
  return {
    phase: 'ready',
    machineDisplayName: 'laptop-m2',
    listing: LISTING,
    isNavigating: false,
    showHidden: false,
    filter: '',
    error: null,
    navigate: noop,
    goUp: noop,
    goHome: noop,
    setShowHidden: noop,
    setFilter: noop,
    retry: noop,
    select: noop,
    cancel: noop,
    ...overrides,
  };
}

describe('breadcrumbSegments', () => {
  it('returns only the root for /', () => {
    expect(breadcrumbSegments('/')).toEqual([{ label: '/', path: '/' }]);
  });

  it('returns every segment when there are at most four', () => {
    expect(breadcrumbSegments('/a/b/c')).toEqual([
      { label: '/', path: '/' },
      { label: 'a', path: '/a' },
      { label: 'b', path: '/a/b' },
      { label: 'c', path: '/a/b/c' },
    ]);
  });

  it('collapses the middle into a non-interactive ellipsis past four segments', () => {
    expect(breadcrumbSegments('/a/b/c/d')).toEqual([
      { label: '/', path: '/' },
      { label: '…', path: '' },
      { label: 'c', path: '/a/b/c' },
      { label: 'd', path: '/a/b/c/d' },
    ]);
  });
});

describe('bodyKindOf', () => {
  it('renders ended for the ended phase, with or without a listing', () => {
    expect(bodyKindOf(makeBrowser({ phase: 'ended' }))).toBe('ended');
    expect(bodyKindOf(makeBrowser({ phase: 'ended', listing: null }))).toBe('ended');
  });

  it('renders the list for error only when a listing is still on screen', () => {
    expect(bodyKindOf(makeBrowser({ phase: 'error' }))).toBe('list');
    expect(bodyKindOf(makeBrowser({ phase: 'error', listing: null }))).toBe('error');
  });

  it('renders the list for no-response only when a listing is still on screen', () => {
    expect(bodyKindOf(makeBrowser({ phase: 'no-response' }))).toBe('list');
    expect(bodyKindOf(makeBrowser({ phase: 'no-response', listing: null }))).toBe('no-response');
  });

  it('renders loading while opening or loading', () => {
    expect(bodyKindOf(makeBrowser({ phase: 'opening', listing: null }))).toBe('loading');
    expect(bodyKindOf(makeBrowser({ phase: 'loading', listing: null }))).toBe('loading');
  });

  it('treats ready without a listing as loading, and ready with a listing as the list', () => {
    expect(bodyKindOf(makeBrowser({ phase: 'ready', listing: null }))).toBe('loading');
    expect(bodyKindOf(makeBrowser({ phase: 'ready' }))).toBe('list');
  });
});

describe('selectDisabledReason', () => {
  it('ended beats every other state', () => {
    expect(
      selectDisabledReason(makeBrowser({ phase: 'ended', isNavigating: true }), 'laptop-m2')
    ).toBe('This session ended. Reopen to choose a folder.');
  });

  it('explains a no-response without a listing', () => {
    expect(
      selectDisabledReason(makeBrowser({ phase: 'no-response', listing: null }), 'laptop-m2')
    ).toBe('No response from laptop-m2. Try again.');
  });

  it('explains an error without a listing', () => {
    expect(selectDisabledReason(makeBrowser({ phase: 'error', listing: null }), 'laptop-m2')).toBe(
      'This folder could not be read. Try again or type a path.'
    );
  });

  it('explains loading when there is no listing yet', () => {
    expect(
      selectDisabledReason(makeBrowser({ phase: 'loading', listing: null }), 'laptop-m2')
    ).toBe('Loading folders…');
  });

  it('no-response with a listing beats isNavigating', () => {
    expect(
      selectDisabledReason(makeBrowser({ phase: 'no-response', isNavigating: true }), 'laptop-m2')
    ).toBe('No response from laptop-m2. Try again to choose a folder.');
  });

  it('explains navigation with the pending path', () => {
    expect(
      selectDisabledReason(makeBrowser({ phase: 'loading', isNavigating: true }), 'laptop-m2')
    ).toBe('Loading /srv/app…');
  });

  it('explains the root folder', () => {
    const root = { ...LISTING, path: '/', parentPath: null, selectable: false };
    expect(selectDisabledReason(makeBrowser({ listing: root }), 'laptop-m2')).toBe(
      "The root folder can't be a workspace. Open a folder inside it."
    );
  });

  it('explains a generic non-selectable folder', () => {
    const unsafe = { ...LISTING, selectable: false };
    expect(selectDisabledReason(makeBrowser({ listing: unsafe }), 'laptop-m2')).toBe(
      "This folder can't be used as a workspace. Open a subfolder or choose another folder."
    );
  });

  it('is null when the listing is selectable and idle', () => {
    expect(selectDisabledReason(makeBrowser(), 'laptop-m2')).toBeNull();
  });
});

describe('errorCopy', () => {
  it('has exact copy for each error code', () => {
    expect(errorCopy({ code: 'PERMISSION_DENIED', path: '/Users/me/private' }, 'laptop-m2')).toBe(
      'Permission denied for /Users/me/private. Choose another folder.'
    );
    expect(errorCopy({ code: 'TIMEOUT', path: '/srv' }, 'laptop-m2')).toBe(
      'Reading /srv took too long. Try again.'
    );
    expect(errorCopy({ code: 'UNSUPPORTED_PLATFORM', path: '/srv' }, 'laptop-m2')).toBe(
      'Folder browsing is not available on laptop-m2. Type the folder path instead.'
    );
    expect(errorCopy({ code: 'READ_FAILED', path: '/srv' }, 'laptop-m2')).toBe(
      'Could not read /srv. Try again or choose another folder.'
    );
  });
});

describe('hiddenToggleLabel', () => {
  it('shows the count of hidden items while hidden items are hidden', () => {
    expect(hiddenToggleLabel(false, 4)).toBe('Show hidden · 4');
  });

  it('shows a plain label when there are no hidden items', () => {
    expect(hiddenToggleLabel(false, 0)).toBe('Show hidden');
  });

  it('offers to hide once hidden items are shown', () => {
    expect(hiddenToggleLabel(true, 0)).toBe('Hide hidden');
  });
});

describe('countsLabel', () => {
  it('uses singular nouns for one', () => {
    expect(countsLabel(1, 1)).toEqual({ folders: '1 folder', files: '1 file' });
  });

  it('uses plural nouns otherwise', () => {
    expect(countsLabel(12, 3)).toEqual({ folders: '12 folders', files: '3 files' });
  });
});

describe('emptyCopy', () => {
  it('returns null when rows exist', () => {
    expect(
      emptyCopy({ dirCount: 2, fileCount: 0, hiddenCount: 0, filter: '', showHidden: false })
    ).toBeNull();
  });

  it('variant A: a filter that matches nothing offers Clear filter', () => {
    expect(
      emptyCopy({ dirCount: 0, fileCount: 4, hiddenCount: 0, filter: 'web', showHidden: false })
    ).toEqual({ title: 'No folders match “web”.', action: 'clear-filter' });
  });

  it('variant B: an empty folder has no subfolders and no files', () => {
    expect(
      emptyCopy({ dirCount: 0, fileCount: 0, hiddenCount: 0, filter: '', showHidden: false })
    ).toEqual({
      title: 'No subfolders here.',
      body: 'Select this folder, or go up one level.',
      action: null,
    });
  });

  it('variant C: only hidden items, while they are hidden, offers Show hidden', () => {
    expect(
      emptyCopy({ dirCount: 0, fileCount: 0, hiddenCount: 3, filter: '', showHidden: false })
    ).toEqual({ title: 'No visible subfolders. 3 hidden items.', action: 'show-hidden' });
  });

  it('variant D: files but no subfolders explains the files', () => {
    expect(
      emptyCopy({ dirCount: 0, fileCount: 5, hiddenCount: 0, filter: '', showHidden: false })
    ).toEqual({ title: 'No subfolders. This folder has 5 files.', action: null });
  });
});

describe('noticeCopy', () => {
  it('returns no notices for an ended session', () => {
    expect(
      noticeCopy(
        makeBrowser({ phase: 'ended', error: { code: 'READ_FAILED', message: 'x', path: '/srv' } })
      )
    ).toEqual([]);
  });

  it('stacks error, no-response, fellBack, complete and truncated in that order', () => {
    const browser = makeBrowser({
      phase: 'no-response',
      error: { code: 'PERMISSION_DENIED', message: 'x', path: '/Users/me/private' },
      listing: {
        ...LISTING,
        requestedPath: '/srv/missing',
        path: '/srv',
        fellBack: true,
        complete: false,
        truncated: true,
        dirCount: 900,
        entries: [{ name: 'alpha' }],
      },
    });
    expect(noticeCopy(browser)).toEqual([
      {
        tone: 'error',
        message: 'Permission denied for /Users/me/private. Choose another folder.',
        action: 'retry',
        actionLabel: 'Retry',
      },
      {
        tone: 'error',
        message: 'laptop-m2 did not answer within 15 seconds. The folder list may be out of date.',
        action: 'retry',
        actionLabel: 'Try again',
      },
      {
        tone: 'info',
        message: '/srv/missing does not exist. Showing /srv, the nearest folder that does.',
        action: null,
        actionLabel: null,
      },
      {
        tone: 'warning',
        message:
          'The scan stopped early, so some folders may be missing. Filter only searches folders already scanned; type a full path to open one directly.',
        action: null,
        actionLabel: null,
      },
      {
        tone: 'warning',
        message: 'Showing the first 1 of 900 folders. Type in Filter to narrow the list.',
        action: null,
        actionLabel: null,
      },
    ]);
  });

  it('returns no notices for a clean listing', () => {
    expect(noticeCopy(makeBrowser())).toEqual([]);
  });
});

describe('liveRegionText', () => {
  it('announces navigation with the pending path', () => {
    expect(liveRegionText(makeBrowser({ isNavigating: true }))).toBe('Loading /srv/app');
  });

  it('announces the shown folder and its folder count', () => {
    expect(liveRegionText(makeBrowser())).toBe('Showing /srv/app, 1 folder');
  });

  it('is empty while loading without a listing', () => {
    expect(liveRegionText(makeBrowser({ phase: 'loading', listing: null }))).toBe('');
  });

  it('is empty when the session ended', () => {
    expect(liveRegionText(makeBrowser({ phase: 'ended' }))).toBe('');
  });
});
