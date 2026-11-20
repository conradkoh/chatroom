import { act, renderHook } from '@testing-library/react';
import type { FunctionReference } from 'convex/server';
import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRepositoryLedger } from './useRepositoryLedger';

interface LedgerRoot {
  path: string;
  status: 'ok' | 'missing' | 'unreadable';
  repositoryCount: number;
}

/** A stored ledger request row as the queries return it. */
interface LedgerRow {
  _id: string;
  status: 'pending' | 'completed' | 'failed';
  rescan: boolean;
  expiresAt: number;
  errorMessage?: string;
  repositoryCount?: number;
  invalidPathCount?: number;
  truncated?: boolean;
  roots?: LedgerRoot[];
  ledgerGeneratedAt?: number;
  completedAt?: number;
  updatedAt: number;
}

interface Page {
  results: {
    path: string;
    name: string;
    root: string;
    discoveredAt: number;
    hasChatroom: boolean;
  }[];
  status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted';
  loadMore: ReturnType<typeof vi.fn>;
}

const REQUEST_1 = 'req-1';
const REQUEST_2 = 'req-2';
const BASE = new Date('2026-11-20T12:00:00Z').getTime();
const FIVE_MINUTES_MS = 5 * 60_000;
const TEN_MINUTES_MS = 10 * 60_000;

const mocks = vi.hoisted(() => ({
  /** A key that is absent means "still loading" (undefined); a null value means "missing". */
  rows: new Map<string, LedgerRow | null>(),
  page: undefined as Page | undefined,
  request: vi.fn(),
  discard: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown, args?: { requestId?: string } | 'skip') => {
    const name = getFunctionName(query as FunctionReference<'query'>);
    if (name === 'repositoryLedger:get') {
      if (args === 'skip') return undefined;
      const requestId = (args as { requestId: string }).requestId;
      return mocks.rows.has(requestId) ? mocks.rows.get(requestId) : undefined;
    }
    throw new Error(`Unexpected query: ${name}`);
  },
  useSessionMutation: (mutation: unknown) => {
    const name = getFunctionName(mutation as FunctionReference<'mutation'>);
    if (name === 'repositoryLedger:request') return mocks.request;
    if (name === 'repositoryLedger:discard') return mocks.discard;
    throw new Error(`Unexpected mutation: ${name}`);
  },
  useSessionPaginatedQuery: (query: unknown) => {
    const name = getFunctionName(query as FunctionReference<'query'>);
    if (name !== 'repositoryLedger:listEntries') {
      throw new Error(`Unexpected paginated query: ${name}`);
    }
    return mocks.page;
  },
}));

function pendingRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    _id: REQUEST_1,
    status: 'pending',
    rescan: false,
    expiresAt: BASE + FIVE_MINUTES_MS,
    updatedAt: BASE,
    ...overrides,
  };
}

function completedRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    _id: REQUEST_1,
    status: 'completed',
    rescan: false,
    expiresAt: BASE + TEN_MINUTES_MS,
    repositoryCount: 0,
    invalidPathCount: 0,
    truncated: false,
    roots: [],
    ledgerGeneratedAt: BASE,
    completedAt: BASE,
    updatedAt: BASE,
    ...overrides,
  };
}

function makePage(overrides: Partial<Page> = {}): Page {
  return { results: [], status: 'Exhausted', loadMore: vi.fn(), ...overrides };
}

function renderLedger(
  gate = { connected: true as boolean | undefined, hasRoots: true as boolean | undefined }
) {
  return renderHook(() => useRepositoryLedger('machine-1', gate));
}

/** Ask for a snapshot and let the mutation resolve to REQUEST_1. */
async function ask(
  result: { current: ReturnType<typeof useRepositoryLedger> },
  rescan = false
): Promise<void> {
  await act(async () => {
    await result.current.request(rescan);
  });
}

describe('useRepositoryLedger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    mocks.rows = new Map();
    mocks.page = makePage();
    mocks.request.mockReset();
    mocks.request.mockResolvedValue({ requestId: REQUEST_1, reused: false });
    mocks.discard.mockReset();
    mocks.discard.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('idle is blocked by offline when disconnected', () => {
    const { result } = renderLedger({ connected: false, hasRoots: true });

    expect(result.current.view).toEqual({
      kind: 'idle',
      canRequest: false,
      blockedBy: 'offline',
    });
    expect(result.current.snapshot).toBeNull();
  });

  it('idle is blocked by no roots when online', () => {
    const { result } = renderLedger({ connected: true, hasRoots: false });

    expect(result.current.view).toEqual({
      kind: 'idle',
      canRequest: false,
      blockedBy: 'no-roots',
    });
  });

  it('idle is requestable when online with roots', () => {
    const { result } = renderLedger({ connected: true, hasRoots: true });

    expect(result.current.view).toEqual({ kind: 'idle', canRequest: true });
    expect(result.current.view).not.toHaveProperty('blockedBy');
  });

  it('request(false) calls the request mutation and shows asking', async () => {
    const { result } = renderLedger();
    mocks.rows.set(REQUEST_1, pendingRow());

    await ask(result);

    expect(mocks.request).toHaveBeenCalledWith({ machineId: 'machine-1', rescan: false });
    expect(result.current.view).toEqual({
      kind: 'asking',
      rescan: false,
      hasPreviousSnapshot: false,
    });
  });

  it('a pending request becomes timed out exactly at its expiresAt', async () => {
    const { result } = renderLedger();
    mocks.rows.set(REQUEST_1, pendingRow({ expiresAt: BASE + FIVE_MINUTES_MS }));

    await ask(result);
    expect(result.current.view.kind).toBe('asking');

    await act(async () => {
      vi.advanceTimersByTime(FIVE_MINUTES_MS - 1);
    });
    expect(result.current.view.kind).toBe('asking');

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.view).toEqual({ kind: 'timedOut' });
  });

  it('a MACHINE_OFFLINE rejection returns to idle blocked by offline', async () => {
    const { result } = renderLedger();
    mocks.request.mockRejectedValue({
      data: { code: 'MACHINE_OFFLINE', message: 'Machine is offline.' },
    });

    await ask(result);

    expect(result.current.view).toEqual({
      kind: 'idle',
      canRequest: false,
      blockedBy: 'offline',
    });
  });

  it('a completed snapshot is ready and loads every page', async () => {
    const loadMore = vi.fn();
    mocks.page = makePage({
      results: [
        { path: '/p/a', name: 'a', root: '/p', discoveredAt: BASE, hasChatroom: false },
        { path: '/p/b', name: 'b', root: '/p', discoveredAt: BASE, hasChatroom: false },
      ],
      status: 'CanLoadMore',
      loadMore,
    });
    mocks.rows.set(
      REQUEST_1,
      completedRow({ repositoryCount: 3, invalidPathCount: 2, truncated: true })
    );

    const { result, rerender } = renderLedger();
    await ask(result);

    expect(result.current.view).toEqual({ kind: 'ready' });
    expect(result.current.snapshot).toMatchObject({
      requestId: REQUEST_1,
      totalCount: 3,
      invalidPathCount: 2,
      truncated: true,
    });
    expect(loadMore).toHaveBeenCalledWith(3);
    expect(result.current.isLoadingPages).toBe(true);

    mocks.page = makePage({ results: mocks.page?.results ?? [], status: 'Exhausted' });
    rerender();

    expect(result.current.isLoadingPages).toBe(false);
    expect(result.current.entries).toHaveLength(2);
  });

  it('a failed row shows its error message, with a fallback when absent', async () => {
    mocks.rows.set(
      REQUEST_1,
      pendingRow({
        status: 'failed',
        errorMessage: 'Disk unreadable',
        expiresAt: BASE + TEN_MINUTES_MS,
      })
    );
    const first = renderLedger();
    await ask(first.result);

    expect(first.result.current.view).toEqual({
      kind: 'failed',
      message: 'Disk unreadable',
    });
    first.unmount();

    mocks.request.mockResolvedValue({ requestId: REQUEST_2, reused: false });
    mocks.rows.set(
      REQUEST_2,
      pendingRow({ _id: REQUEST_2, status: 'failed', expiresAt: BASE + TEN_MINUTES_MS })
    );
    const second = renderLedger();
    await ask(second.result);

    expect(second.result.current.view).toEqual({
      kind: 'failed',
      message: 'The daemon reported an error.',
    });
  });

  it('a completed snapshot past expiresAt is idle with reason expired', async () => {
    mocks.rows.set(REQUEST_1, completedRow({ expiresAt: BASE + 1_000 }));

    const { result } = renderLedger();
    await ask(result);
    expect(result.current.snapshot).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.snapshot).toBeNull();
    expect(result.current.view).toMatchObject({ kind: 'idle', reason: 'expired' });
  });

  it('rescan keeps the previous snapshot, then swaps and discards it', async () => {
    mocks.rows.set(REQUEST_1, completedRow({ repositoryCount: 2 }));
    const { result, rerender } = renderLedger();
    await ask(result);
    expect(result.current.snapshot?.requestId).toBe(REQUEST_1);

    mocks.request.mockResolvedValue({ requestId: REQUEST_2, reused: false });
    mocks.rows.set(REQUEST_2, pendingRow({ _id: REQUEST_2 }));

    await ask(result, true);

    expect(result.current.view).toEqual({
      kind: 'asking',
      rescan: true,
      hasPreviousSnapshot: true,
    });
    expect(result.current.snapshot?.requestId).toBe(REQUEST_1);

    mocks.rows.set(REQUEST_2, completedRow({ _id: REQUEST_2, repositoryCount: 4 }));
    rerender();

    expect(result.current.snapshot?.requestId).toBe(REQUEST_2);
    expect(mocks.discard).toHaveBeenCalledWith({ requestId: REQUEST_1 });
  });

  it('a rescan that times out keeps the snapshot and reports a rescan issue', async () => {
    mocks.rows.set(REQUEST_1, completedRow({ repositoryCount: 2 }));
    const { result } = renderLedger();
    await ask(result);

    mocks.request.mockResolvedValue({ requestId: REQUEST_2, reused: false });
    mocks.rows.set(REQUEST_2, pendingRow({ _id: REQUEST_2, rescan: true }));

    await ask(result, true);
    await act(async () => {
      vi.advanceTimersByTime(FIVE_MINUTES_MS);
    });

    expect(result.current.view).toEqual({
      kind: 'ready',
      rescanIssue: { kind: 'timedOut' },
    });
    expect(result.current.snapshot?.requestId).toBe(REQUEST_1);
  });

  it('cancel returns to idle and discards the pending and shown requests', async () => {
    mocks.rows.set(REQUEST_1, completedRow());
    const { result } = renderLedger();
    await ask(result);

    mocks.request.mockResolvedValue({ requestId: REQUEST_2, reused: false });
    mocks.rows.set(REQUEST_2, pendingRow({ _id: REQUEST_2 }));
    await ask(result, true);

    act(() => {
      result.current.cancel();
    });

    expect(result.current.view).toMatchObject({ kind: 'idle' });
    expect(mocks.discard).toHaveBeenCalledWith({ requestId: REQUEST_2 });
    expect(mocks.discard).toHaveBeenCalledWith({ requestId: REQUEST_1 });
  });

  it('unmounting discards the shown request', async () => {
    mocks.rows.set(REQUEST_1, completedRow());
    const { result, unmount } = renderLedger();
    await ask(result);

    unmount();

    expect(mocks.discard).toHaveBeenCalledWith({ requestId: REQUEST_1 });
  });

  it('re-rendering with changed props does not discard', async () => {
    mocks.rows.set(REQUEST_1, completedRow());
    const { result, rerender } = renderHook(
      ({ connected }: { connected: boolean | undefined }) =>
        useRepositoryLedger('machine-1', { connected, hasRoots: true }),
      { initialProps: { connected: true as boolean | undefined } }
    );
    await ask(result);
    mocks.discard.mockClear();

    rerender({ connected: false });

    expect(mocks.discard).not.toHaveBeenCalled();
  });

  it('never schedules an interval while requesting, ready, or rescanning', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    mocks.rows.set(REQUEST_1, pendingRow());
    const { result, rerender } = renderLedger();
    await ask(result);

    mocks.rows.set(REQUEST_1, completedRow());
    rerender();

    mocks.request.mockResolvedValue({ requestId: REQUEST_2, reused: false });
    mocks.rows.set(REQUEST_2, pendingRow({ _id: REQUEST_2 }));
    await ask(result, true);

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('a consumer that reused a pending request does not discard it on unmount or cancel', async () => {
    mocks.request.mockResolvedValue({ requestId: REQUEST_1, reused: true });
    mocks.rows.set(REQUEST_1, pendingRow());
    const { result, unmount } = renderLedger();
    await ask(result);
    expect(result.current.view.kind).toBe('asking');

    act(() => {
      result.current.cancel();
    });
    unmount();

    expect(mocks.discard).not.toHaveBeenCalled();
  });

  it('a consumer that created a pending request discards it on unmount', async () => {
    mocks.rows.set(REQUEST_1, pendingRow());
    const { result, unmount } = renderLedger();
    await ask(result);

    unmount();

    expect(mocks.discard).toHaveBeenCalledWith({ requestId: REQUEST_1 });
  });

  it('a reused completed snapshot is not discarded on unmount', async () => {
    mocks.request.mockResolvedValue({ requestId: REQUEST_1, reused: true });
    mocks.rows.set(REQUEST_1, completedRow());
    const { result, unmount } = renderLedger();
    await ask(result);
    expect(result.current.snapshot?.requestId).toBe(REQUEST_1);

    unmount();

    expect(mocks.discard).not.toHaveBeenCalled();
  });

  it('a reused request that disappears shows neutral idle, not expired', async () => {
    mocks.request.mockResolvedValue({ requestId: REQUEST_1, reused: true });
    mocks.rows.set(REQUEST_1, pendingRow());
    const { result, rerender } = renderLedger();
    await ask(result);

    mocks.rows.set(REQUEST_1, null);
    rerender();

    expect(result.current.view).toEqual({ kind: 'idle', canRequest: true });
  });

  it('a reused snapshot that its creator discarded shows neutral idle, not expired', async () => {
    mocks.request.mockResolvedValue({ requestId: REQUEST_1, reused: true });
    mocks.rows.set(REQUEST_1, completedRow());
    const { result, rerender } = renderLedger();
    await ask(result);
    expect(result.current.snapshot).not.toBeNull();

    mocks.rows.set(REQUEST_1, null);
    rerender();

    expect(result.current.snapshot).toBeNull();
    expect(result.current.view).toEqual({ kind: 'idle', canRequest: true });
  });

  it('a created snapshot whose row disappears still reads as expired', async () => {
    mocks.rows.set(REQUEST_1, completedRow());
    const { result, rerender } = renderLedger();
    await ask(result);

    mocks.rows.set(REQUEST_1, null);
    rerender();

    expect(result.current.view).toEqual({ kind: 'idle', reason: 'expired', canRequest: true });
  });

  it('a 1,000-entry snapshot loads across chunk pages and resolves hasChatroom on every page', async () => {
    const CHUNK_ENTRIES = 100;
    const TOTAL = 1000;
    const SERVER_CHUNK_CLAMP = 10;
    const all = Array.from({ length: TOTAL }, (_, i) => ({
      path: `/p/repo-${i}`,
      name: `repo-${i}`,
      root: '/p',
      discoveredAt: BASE,
      hasChatroom: i === 0 || i === 450 || i === 999,
    }));
    const requested: number[] = [];
    const pageWith = (loaded: number): Page => ({
      results: all.slice(0, loaded),
      status: loaded >= TOTAL ? 'Exhausted' : 'CanLoadMore',
      loadMore: vi.fn((numItems: number) => {
        requested.push(numItems);
        mocks.page = pageWith(Math.min(TOTAL, loaded + numItems * CHUNK_ENTRIES));
      }),
    });
    mocks.page = pageWith(300);
    mocks.rows.set(REQUEST_1, completedRow({ repositoryCount: TOTAL }));

    const { result, rerender } = renderLedger();
    await ask(result);
    for (let i = 0; i < 20 && result.current.isLoadingPages; i++) {
      act(() => {
        rerender();
      });
    }

    expect(requested).toEqual([3, 3, 3]);
    expect(Math.max(...requested)).toBeLessThanOrEqual(SERVER_CHUNK_CLAMP);
    expect(result.current.isLoadingPages).toBe(false);
    expect(result.current.entries).toHaveLength(TOTAL);
    expect(result.current.entries.filter((e) => e.hasChatroom).map((e) => e.name)).toEqual([
      'repo-0',
      'repo-450',
      'repo-999',
    ]);
  });
});
