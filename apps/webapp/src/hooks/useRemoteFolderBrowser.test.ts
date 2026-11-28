import { act, renderHook } from '@testing-library/react';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRemoteFolderBrowser } from './useRemoteFolderBrowser';

const queryState = vi.hoisted(() => ({
  header: undefined as unknown,
  listing: undefined as unknown,
}));

const mutations = vi.hoisted(() => ({
  open: vi.fn(),
  navigate: vi.fn(),
  close: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (fn: string, args: unknown) => {
    if (args === 'skip') return undefined;
    return fn === 'folderBrowse:get' ? queryState.header : queryState.listing;
  },
  useSessionMutation: (fn: string) => {
    if (fn === 'folderBrowse:open') return mutations.open;
    if (fn === 'folderBrowse:navigate') return mutations.navigate;
    return mutations.close;
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    folderBrowse: {
      open: 'folderBrowse:open',
      navigate: 'folderBrowse:navigate',
      close: 'folderBrowse:close',
      get: 'folderBrowse:get',
      getListing: 'folderBrowse:getListing',
    },
  },
}));

const MACHINE_ID = 'machine-1';
const MACHINE_DISPLAY_NAME = 'Studio Mac';
const BROWSE_ID = 'jd7browse0000000000000000001';
const NO_RESPONSE_MS = 15_000;
const TEN_MINUTES_MS = 10 * 60_000;

function makeHeader(overrides: Record<string, unknown> = {}) {
  return {
    browseId: BROWSE_ID,
    machineId: MACHINE_ID,
    state: 'pending',
    navSeq: 1,
    requestedPath: '/srv/app',
    showHidden: false,
    filter: null,
    pendingSince: Date.now(),
    error: null,
    expiresAt: Date.now() + TEN_MINUTES_MS,
    ...overrides,
  };
}

function makeListing(overrides: Record<string, unknown> = {}) {
  return {
    seq: 1,
    requestedPath: '/srv/app',
    path: '/srv/app',
    parentPath: '/srv',
    entries: [{ name: 'alpha' }, { name: 'beta', symlink: true }],
    dirCount: 2,
    fileCount: 3,
    hiddenCount: 1,
    truncated: false,
    complete: true,
    selectable: true,
    listedAt: Date.now(),
    ...overrides,
  };
}

function renderBrowser(
  options: { machineId?: string | null; onSelected?: (path: string) => void } = {}
) {
  const onSelected = options.onSelected ?? vi.fn();
  const view = renderHook(() =>
    useRemoteFolderBrowser({
      machineId: options.machineId === undefined ? MACHINE_ID : options.machineId,
      machineDisplayName: MACHINE_DISPLAY_NAME,
      onSelected,
    })
  );
  return { ...view, onSelected };
}

/** Open a session and flush the mutation promise. */
async function openBrowser(result: { current: { open: (path: string) => Promise<void> } }) {
  await act(async () => {
    await result.current.open('/srv/app');
  });
}

/** Give the hook a ready header and one listing, then re-render. */
function showReadyListing(
  rerender: () => void,
  headerOverrides: Record<string, unknown> = {},
  listingOverrides: Record<string, unknown> = {}
) {
  queryState.header = makeHeader({ state: 'ready', pendingSince: null, ...headerOverrides });
  queryState.listing = makeListing(listingOverrides);
  rerender();
}

describe('useRemoteFolderBrowser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-28T00:00:00.000Z'));
    queryState.header = undefined;
    queryState.listing = undefined;
    mutations.open.mockReset().mockResolvedValue({ browseId: BROWSE_ID });
    mutations.navigate.mockReset().mockResolvedValue({ navSeq: 2 });
    mutations.close.mockReset().mockResolvedValue({ closed: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens at the typed absolute path and shows opening until the session exists', async () => {
    let resolveOpen: ((value: { browseId: string }) => void) | undefined;
    mutations.open.mockReturnValue(
      new Promise((resolve) => {
        resolveOpen = resolve;
      })
    );

    const { result } = renderBrowser();
    act(() => {
      void result.current.open('  /srv/app  ');
    });

    expect(result.current.browser?.phase).toBe('opening');
    expect(result.current.browser?.listing).toBeNull();
    expect(mutations.open).toHaveBeenCalledWith({ machineId: MACHINE_ID, path: '/srv/app' });

    await act(async () => {
      resolveOpen?.({ browseId: BROWSE_ID });
    });
    expect(result.current.browser?.phase).toBe('loading');
  });

  it.each(['', '   ', 'relative/path'])('opens at home for start path %j', async (startPath) => {
    const { result } = renderBrowser();
    await act(async () => {
      await result.current.open(startPath);
    });
    expect(mutations.open).toHaveBeenCalledWith({ machineId: MACHINE_ID });
  });

  it('refuses to open without a machine', async () => {
    const { result } = renderBrowser({ machineId: null });
    await expect(result.current.open('/srv/app')).rejects.toThrow('Select a machine first');
    expect(mutations.open).not.toHaveBeenCalled();
    expect(result.current.browser).toBeNull();
  });

  it('rethrows an open failure and leaves no browser', async () => {
    mutations.open.mockRejectedValue(
      new ConvexError({ code: 'MACHINE_NOT_FOUND', message: 'Machine not found' })
    );
    const { result } = renderBrowser();
    await act(async () => {
      await expect(result.current.open('/srv/app')).rejects.toThrow();
    });
    expect(result.current.browser).toBeNull();
  });

  it('closes the previous session before opening a new one', async () => {
    const { result } = renderBrowser();
    await openBrowser(result);
    await act(async () => {
      await result.current.open('/srv/other');
    });
    expect(mutations.close).toHaveBeenCalledWith({ browseId: BROWSE_ID });
  });

  it('is ready with a listing and navigating while the next listing is pending', async () => {
    const { result, rerender } = renderBrowser();
    await openBrowser(result);

    showReadyListing(rerender);
    expect(result.current.browser?.phase).toBe('ready');
    expect(result.current.browser?.isNavigating).toBe(false);
    expect(result.current.browser?.listing?.entries.map((entry) => entry.name)).toEqual([
      'alpha',
      'beta',
    ]);
    expect(result.current.browser?.machineDisplayName).toBe(MACHINE_DISPLAY_NAME);

    queryState.header = makeHeader({ state: 'pending', pendingSince: Date.now() });
    rerender();
    expect(result.current.browser?.phase).toBe('ready');
    expect(result.current.browser?.isNavigating).toBe(true);
  });

  it('derives fellBack from the requested path', async () => {
    const { result, rerender } = renderBrowser();
    await openBrowser(result);

    showReadyListing(
      rerender,
      { requestedPath: '/srv/missing' },
      { requestedPath: '/srv/missing', path: '/srv' }
    );
    expect(result.current.browser?.listing?.fellBack).toBe(true);

    showReadyListing(rerender, { requestedPath: null }, { requestedPath: null, path: '/home/e2e' });
    expect(result.current.browser?.listing?.fellBack).toBe(false);
  });

  it('shows loading until 15 s pass without a listing, then no-response', async () => {
    const { result, rerender } = renderBrowser();
    await openBrowser(result);

    queryState.header = makeHeader({ state: 'pending', pendingSince: Date.now() });
    rerender();
    expect(result.current.browser?.phase).toBe('loading');

    act(() => {
      vi.advanceTimersByTime(NO_RESPONSE_MS - 1);
    });
    expect(result.current.browser?.phase).toBe('loading');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.browser?.phase).toBe('no-response');
  });

  it('ends when the session document disappears', async () => {
    const { result, rerender } = renderBrowser();
    await openBrowser(result);

    queryState.header = null;
    queryState.listing = null;
    rerender();
    expect(result.current.browser?.phase).toBe('ended');
  });

  it('ends at expiresAt while the row still says ready', async () => {
    const expiresAt = Date.now() + 60_000;
    const { result, rerender } = renderBrowser();
    await openBrowser(result);

    showReadyListing(rerender, { expiresAt });
    expect(result.current.browser?.phase).toBe('ready');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.browser?.phase).toBe('ended');
  });

  it('shows the daemon error and keeps the previous listing', async () => {
    const { result, rerender } = renderBrowser();
    await openBrowser(result);

    queryState.listing = makeListing();
    queryState.header = makeHeader({
      state: 'error',
      pendingSince: null,
      error: { code: 'PERMISSION_DENIED', message: 'Permission denied', path: '/srv/secret' },
    });
    rerender();

    expect(result.current.browser?.phase).toBe('error');
    expect(result.current.browser?.error).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'Permission denied',
      path: '/srv/secret',
    });
    expect(result.current.browser?.listing?.path).toBe('/srv/app');
  });

  it('navigates into a child, up, and home with the current toggles', async () => {
    const { result, rerender } = renderBrowser();
    await openBrowser(result);
    showReadyListing(rerender);

    act(() => {
      result.current.browser?.navigate('/srv/app/alpha');
    });
    expect(mutations.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ browseId: BROWSE_ID, path: '/srv/app/alpha', showHidden: false })
    );

    act(() => {
      result.current.browser?.goUp();
    });
    expect(mutations.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ browseId: BROWSE_ID, path: '/srv' })
    );

    act(() => {
      result.current.browser?.goHome();
    });
    expect(mutations.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ browseId: BROWSE_ID, path: null })
    );
  });

  it('does not go up from the root listing', async () => {
    const { result, rerender } = renderBrowser();
    await openBrowser(result);
    showReadyListing(rerender, {}, { path: '/', requestedPath: '/', parentPath: null });

    act(() => {
      result.current.browser?.goUp();
    });
    expect(mutations.navigate).not.toHaveBeenCalled();
  });

  it('applies a hidden toggle immediately and navigates with it', async () => {
    const { result, rerender } = renderBrowser();
    await openBrowser(result);
    showReadyListing(rerender);

    act(() => {
      result.current.browser?.setShowHidden(true);
    });

    expect(result.current.browser?.showHidden).toBe(true);
    expect(mutations.navigate).toHaveBeenCalledWith({
      browseId: BROWSE_ID,
      path: '/srv/app',
      showHidden: true,
      filter: undefined,
    });
  });

  it('debounces the filter navigate by 300 ms with the latest text', async () => {
    const { result, rerender } = renderBrowser();
    await openBrowser(result);
    showReadyListing(rerender);

    act(() => {
      result.current.browser?.setFilter('al');
    });
    expect(result.current.browser?.filter).toBe('al');
    expect(mutations.navigate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      result.current.browser?.setFilter('alp');
    });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(mutations.navigate).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(mutations.navigate).toHaveBeenCalledTimes(1);
    expect(mutations.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ browseId: BROWSE_ID, path: '/srv/app', filter: 'alp' })
    );
  });

  it('selects a folder, reports the path, and closes the session', async () => {
    const onSelected = vi.fn();
    const { result, rerender } = renderBrowser({ onSelected });
    await openBrowser(result);
    showReadyListing(rerender, {}, { path: '/srv/app/alpha', selectable: true });

    act(() => {
      result.current.browser?.select();
    });

    expect(onSelected).toHaveBeenCalledWith('/srv/app/alpha');
    expect(mutations.close).toHaveBeenCalledWith({ browseId: BROWSE_ID });
    expect(result.current.browser).toBeNull();
  });

  it('does not select a folder the backend marks unselectable', async () => {
    const onSelected = vi.fn();
    const { result, rerender } = renderBrowser({ onSelected });
    await openBrowser(result);
    showReadyListing(
      rerender,
      {},
      { path: '/', requestedPath: '/', parentPath: null, selectable: false }
    );

    act(() => {
      result.current.browser?.select();
    });

    expect(onSelected).not.toHaveBeenCalled();
    expect(mutations.close).not.toHaveBeenCalled();
  });

  it('cancels the session', async () => {
    const { result } = renderBrowser();
    await openBrowser(result);

    act(() => {
      result.current.browser?.cancel();
    });

    expect(mutations.close).toHaveBeenCalledWith({ browseId: BROWSE_ID });
    expect(result.current.browser).toBeNull();
  });

  it('closes the session on unmount', async () => {
    const { result, unmount } = renderBrowser();
    await openBrowser(result);

    unmount();
    expect(mutations.close).toHaveBeenCalledWith({ browseId: BROWSE_ID });
  });

  it('does not close anything on unmount when no session was opened', () => {
    const { unmount } = renderBrowser();
    unmount();
    expect(mutations.close).not.toHaveBeenCalled();
  });

  it('closes a session that finishes opening after cancel', async () => {
    let resolveOpen: ((value: { browseId: string }) => void) | undefined;
    mutations.open.mockReturnValue(
      new Promise((resolve) => {
        resolveOpen = resolve;
      })
    );
    const { result } = renderBrowser();
    act(() => {
      void result.current.open('/srv/app');
    });

    act(() => {
      result.current.close();
    });
    await act(async () => {
      resolveOpen?.({ browseId: BROWSE_ID });
    });

    expect(mutations.close).toHaveBeenCalledTimes(1);
    expect(mutations.close).toHaveBeenCalledWith({ browseId: BROWSE_ID });
    expect(result.current.browser).toBeNull();
  });

  it('closes a session that finishes opening after unmount', async () => {
    let resolveOpen: ((value: { browseId: string }) => void) | undefined;
    mutations.open.mockReturnValue(
      new Promise((resolve) => {
        resolveOpen = resolve;
      })
    );
    const { result, unmount } = renderBrowser();
    act(() => {
      void result.current.open('/srv/app');
    });

    unmount();
    await act(async () => {
      resolveOpen?.({ browseId: BROWSE_ID });
    });

    expect(mutations.close).toHaveBeenCalledWith({ browseId: BROWSE_ID });
  });

  it('ignores an earlier open that resolves after a newer one', async () => {
    const resolvers: ((value: { browseId: string }) => void)[] = [];
    mutations.open.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })
    );
    const { result } = renderBrowser();
    act(() => {
      void result.current.open('/srv/a');
    });
    act(() => {
      void result.current.open('/srv/b');
    });

    await act(async () => {
      resolvers[1]({ browseId: 'jd7browse0000000000000000002' });
    });
    await act(async () => {
      resolvers[0]({ browseId: 'jd7browse0000000000000000003' });
    });

    expect(mutations.close).toHaveBeenCalledWith({ browseId: 'jd7browse0000000000000000003' });
    expect(mutations.close).not.toHaveBeenCalledWith({ browseId: 'jd7browse0000000000000000002' });
  });

  it('reopens at the last start path when retrying an ended session', async () => {
    const { result, rerender } = renderBrowser();
    await openBrowser(result);

    queryState.header = null;
    queryState.listing = null;
    rerender();
    expect(result.current.browser?.phase).toBe('ended');
    mutations.open.mockClear();

    act(() => {
      result.current.browser?.retry();
    });

    expect(mutations.open).toHaveBeenCalledWith({ machineId: MACHINE_ID, path: '/srv/app' });
  });

  it('ends when a navigate rejects with FOLDER_BROWSE_EXPIRED', async () => {
    mutations.navigate.mockRejectedValue(
      new ConvexError({ code: 'FOLDER_BROWSE_EXPIRED', message: 'Folder browse session expired' })
    );
    const { result, rerender } = renderBrowser();
    await openBrowser(result);
    showReadyListing(rerender);

    await act(async () => {
      result.current.browser?.navigate('/srv/app/alpha');
    });
    await act(async () => {});

    expect(result.current.browser?.phase).toBe('ended');
  });

  it('shows a non-terminal navigate rejection as error with the backend message', async () => {
    mutations.navigate.mockRejectedValue(
      new ConvexError({ code: 'FOLDER_BROWSE_INVALID_PATH', message: 'Path must be absolute' })
    );
    const { result, rerender } = renderBrowser();
    await openBrowser(result);
    showReadyListing(rerender);

    await act(async () => {
      result.current.browser?.navigate('relative');
    });
    await act(async () => {});

    expect(result.current.browser?.phase).toBe('error');
    expect(result.current.browser?.error).toEqual({
      code: 'READ_FAILED',
      message: 'Path must be absolute',
      path: 'relative',
    });
  });

  it('reopens at the current path when retrying a no-response session', async () => {
    const { result, rerender } = renderBrowser();
    await openBrowser(result);

    queryState.header = makeHeader({ state: 'pending', pendingSince: Date.now() });
    rerender();
    act(() => {
      vi.advanceTimersByTime(NO_RESPONSE_MS);
    });
    expect(result.current.browser?.phase).toBe('no-response');
    mutations.open.mockClear();

    act(() => {
      result.current.browser?.retry();
    });

    expect(mutations.open).toHaveBeenCalledWith({ machineId: MACHINE_ID, path: '/srv/app' });
  });

  it('re-navigates when retrying a daemon error', async () => {
    const { result, rerender } = renderBrowser();
    await openBrowser(result);

    queryState.listing = makeListing();
    queryState.header = makeHeader({
      state: 'error',
      pendingSince: null,
      error: { code: 'TIMEOUT', message: 'Timed out', path: '/srv/app' },
    });
    rerender();
    expect(result.current.browser?.phase).toBe('error');
    mutations.open.mockClear();

    act(() => {
      result.current.browser?.retry();
    });

    expect(mutations.open).not.toHaveBeenCalled();
    expect(mutations.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ browseId: BROWSE_ID, path: '/srv/app' })
    );
  });

  it('drives open, listing, navigation and selection end to end', async () => {
    const onSelected = vi.fn();
    const { result, rerender } = renderBrowser({ onSelected });

    await act(async () => {
      await result.current.open('/srv/app');
    });
    expect(mutations.open).toHaveBeenCalledWith({ machineId: MACHINE_ID, path: '/srv/app' });

    queryState.header = makeHeader({ state: 'pending', pendingSince: Date.now() });
    rerender();
    expect(result.current.browser?.phase).toBe('loading');

    showReadyListing(rerender);
    expect(result.current.browser?.phase).toBe('ready');
    expect(result.current.browser?.listing?.path).toBe('/srv/app');

    act(() => {
      result.current.browser?.navigate('/srv/app/alpha');
    });
    expect(mutations.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ browseId: BROWSE_ID, path: '/srv/app/alpha' })
    );

    queryState.header = makeHeader({ state: 'pending', pendingSince: Date.now(), navSeq: 2 });
    rerender();
    expect(result.current.browser?.isNavigating).toBe(true);

    showReadyListing(
      rerender,
      { navSeq: 2 },
      {
        seq: 2,
        path: '/srv/app/alpha',
        requestedPath: '/srv/app/alpha',
        parentPath: '/srv/app',
        entries: [],
      }
    );
    expect(result.current.browser?.phase).toBe('ready');
    expect(result.current.browser?.listing?.path).toBe('/srv/app/alpha');

    act(() => {
      result.current.browser?.select();
    });
    expect(onSelected).toHaveBeenCalledWith('/srv/app/alpha');
    expect(mutations.close).toHaveBeenCalledWith({ browseId: BROWSE_ID });
    expect(result.current.browser).toBeNull();

    expect(mutations.navigate).toHaveBeenCalledTimes(1);
  });
});
