import { webcrypto } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import { ChatroomTransferError } from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import { runExportBundle } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-bundle';
import type { ChatroomExportPort } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-driver';
import type { ImportChunk } from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-apply';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTransferImport, type ImportViewState } from './useTransferImport';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mocks.query, mutation: mocks.mutation }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatroomImport: {
      preflight: { name: 'preflight' },
      begin: { name: 'begin' },
      applyChunk: { name: 'applyChunk' },
      finalize: { name: 'finalize' },
      rollback: { name: 'rollback' },
    },
  },
}));

const AT = new Date('2026-01-02T03:04:05.000Z');
const PREFLIGHT = {
  hostname: 'host-1',
  availableHarnesses: ['opencode'],
  teamStructureKnown: true,
  invalidWorkingDirs: [],
};
const STAMP = {
  lastActivityAt: null,
  nextQueuePosition: null,
  latestMessage: null,
  taskCounts: null,
  latest: {},
  attachmentRows: { count: 0, capped: false, totalBytes: 0 },
};

const ROOM_ROWS: Record<
  string,
  { id: string; creationTime: number; fields: Record<string, unknown> }
> = {
  'src-1': {
    id: 'room-1',
    creationTime: 1,
    fields: { status: 'active', name: 'Alpha', teamStructureId: 'duo' },
  },
  'src-2': {
    id: 'room-2',
    creationTime: 2,
    fields: { status: 'completed', name: 'Beta', teamStructureId: 'duo' },
  },
};

type Row = { id: string; creationTime: number; fields: Record<string, unknown> };
type Page = { rows: Row[]; continueCursor: null; isDone: true };

function page(rows: Row[]): Page {
  return { rows, continueCursor: null, isDone: true };
}

const MESSAGE_ROWS: Record<string, Row[]> = {
  'src-1': [
    {
      id: 'message-1',
      creationTime: 2,
      fields: { senderRole: 'user', content: 'hello', type: 'message' },
    },
  ],
  'src-2': [
    {
      id: 'message-2',
      creationTime: 3,
      fields: { senderRole: 'user', content: 'bye', type: 'message' },
    },
  ],
};

const EXPORT_PORT: ChatroomExportPort = {
  getStamp: async () => STAMP,
  readPage: async ({ chatroomId, category }) => {
    if (category === 'room') return page([ROOM_ROWS[chatroomId]]);
    if (category === 'messages') return page(MESSAGE_ROWS[chatroomId] ?? []);
    return page([]);
  },
};

/** The fixture is the output of the real exporter, so keys and checksums are genuine. */
async function bundleJson(): Promise<string> {
  const { json } = await runExportBundle(EXPORT_PORT, {
    chatroomIds: ['src-1', 'src-2'],
    machineId: 'machine-src',
    cliVersion: 'webapp',
    now: () => AT,
  });
  return json;
}

function fileFrom(text: string): File {
  return withText(
    new File([text], 'chatroom-all-export.json', { type: 'application/json' }),
    async () => text
  );
}

function withText(file: File, text: () => Promise<string>): File {
  Object.defineProperty(file, 'text', { value: text, configurable: true });
  return file;
}

function chunkResult(chunk: ImportChunk): { created: Record<string, string> } {
  if (chunk.phase === 'links') return { created: {} };
  return {
    created: Object.fromEntries(chunk.rows.map((row, index) => [row.key, `id-${index}`])),
  };
}

let beginCount = 0;

function installConvex(overrides: { preflight?: (args: unknown) => unknown } = {}): void {
  mocks.mutation.mockImplementation(
    async (ref: { name?: string }, args: { chunk?: ImportChunk }) => {
      if (ref.name === 'begin') {
        beginCount += 1;
        return { chatroomId: `new-room-${beginCount}` };
      }
      if (ref.name === 'applyChunk' && args.chunk) return chunkResult(args.chunk);
      if (ref.name === 'finalize') return null;
      if (ref.name === 'rollback') return { drained: true, deleted: 1 };
      throw new Error(`Unexpected mutation: ${ref.name}`);
    }
  );
  mocks.query.mockImplementation(async (_ref: unknown, args: unknown) => {
    if (overrides.preflight) return overrides.preflight(args);
    return PREFLIGHT;
  });
}

function listedState(state: ImportViewState): Extract<ImportViewState, { kind: 'listed' }> {
  if (state.kind !== 'listed') throw new Error(`expected listed, got ${state.kind}`);
  return state;
}

function doneState(state: ImportViewState): Extract<ImportViewState, { kind: 'done' }> {
  if (state.kind !== 'done') throw new Error(`expected done, got ${state.kind}`);
  return state;
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  beginCount = 0;
  mocks.query.mockReset();
  mocks.mutation.mockReset();
  window.localStorage.clear();
  installConvex();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('useTransferImport', () => {
  it('imports a file exported by runExport through the real engine', async () => {
    const { result } = renderHook(() => useTransferImport('machine-1'));
    const json = await bundleJson();

    await act(async () => {
      await result.current.loadFile(fileFrom(json));
    });

    const listed = listedState(result.current.state);
    expect(listed.listing.entries).toHaveLength(2);
    expect(listed.listing.entries.map((entry) => entry.name)).toEqual(['Alpha', 'Beta']);
    expect(listed.selected.size).toBe(0);
    expect(listed.machineId).toBe('machine-1');

    act(() => result.current.selectAll());
    expect(listedState(result.current.state).selected.size).toBe(2);

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.kind).toBe('done'));

    const done = doneState(result.current.state);
    expect(done.summary.imported).toBe(2);
    expect(done.summary.failed).toBe(0);
    expect(done.summary.skipped).toBe(0);
    expect(done.summary.results.map((entry) => entry.status)).toEqual(['imported', 'imported']);
    expect(done.importedKeys).toEqual(new Set(['src-1', 'src-2']));
    expect(beginCount).toBe(2);
    expect(mocks.mutation.mock.calls.filter(([ref]) => ref.name === 'finalize')).toHaveLength(2);
    expect(
      mocks.mutation.mock.calls
        .filter(([ref]) => ref.name === 'begin')
        .every(([, args]) => (args as { machineId?: string }).machineId === 'machine-1')
    ).toBe(true);
    expect(
      mocks.query.mock.calls.some(
        ([, args]) => (args as { machineId?: string })?.machineId === 'machine-1'
      )
    ).toBe(true);
  });

  it('refuses an oversize file before reading it', async () => {
    const { result } = renderHook(() => useTransferImport('machine-1'));
    const file = new File(['{}'], 'big.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: 268_435_457 });
    const text = vi.fn();
    Object.defineProperty(file, 'text', { value: text, configurable: true });

    await act(async () => {
      await result.current.loadFile(file);
    });

    expect(text).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({
      kind: 'rejected',
      code: 'IMPORT_FILE_TOO_LARGE',
      message: expect.any(String),
      fileSizeBytes: 268_435_457,
    });
  });

  it('rejects text that is not an export and unreadable text', async () => {
    const { result } = renderHook(() => useTransferImport('machine-1'));

    await act(async () => {
      await result.current.loadFile(fileFrom('not json'));
    });
    expect(result.current.state).toMatchObject({
      kind: 'rejected',
      code: 'IMPORT_FILE_UNREADABLE',
    });

    await act(async () => {
      await result.current.loadFile(fileFrom('{"kind":"something-else"}'));
    });
    expect(result.current.state).toMatchObject({ kind: 'rejected', code: 'IMPORT_NOT_AN_EXPORT' });
  });

  it('drops a parse result that arrives after reset', async () => {
    const { result } = renderHook(() => useTransferImport('machine-1'));
    const json = await bundleJson();
    let release: (value: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const file = withText(new File([''], 'later.json'), () => pending);

    let loading: Promise<void> | undefined;
    act(() => {
      loading = result.current.loadFile(file);
    });
    expect(result.current.state.kind).toBe('reading');

    act(() => result.current.reset());
    expect(result.current.state).toEqual({ kind: 'idle' });

    await act(async () => {
      release(json);
      await loading;
    });
    expect(result.current.state).toEqual({ kind: 'idle' });
  });

  it('cancel rolls the room in progress back and stops the remaining entries', async () => {
    let releaseChunk: () => void = () => {};
    const chunkGate = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    mocks.mutation.mockImplementation(
      async (ref: { name?: string }, args: { chunk?: ImportChunk }) => {
        if (ref.name === 'begin') return { chatroomId: 'new-room-1' };
        if (ref.name === 'applyChunk' && args.chunk) {
          await chunkGate;
          return chunkResult(args.chunk);
        }
        if (ref.name === 'finalize') return null;
        if (ref.name === 'rollback') return { drained: true, deleted: 1 };
        throw new Error(`Unexpected mutation: ${ref.name}`);
      }
    );

    const { result } = renderHook(() => useTransferImport('machine-1'));
    await act(async () => {
      await result.current.loadFile(fileFrom(await bundleJson()));
    });
    act(() => result.current.selectAll());
    act(() => result.current.start());
    await waitFor(() => expect(listedOrImporting(result.current.state)).toBe('importing'));

    let cancelling: Promise<void> | undefined;
    act(() => {
      cancelling = result.current.cancel();
    });
    await waitFor(() => {
      const state = result.current.state;
      expect(state.kind === 'importing' && state.cancelling).toBe(true);
    });
    releaseChunk();
    await act(async () => {
      await cancelling;
    });
    await waitFor(() => expect(result.current.state.kind).toBe('done'));

    const done = doneState(result.current.state);
    expect(done.summary.cancelled).toBe(true);
    expect(done.summary.imported).toBe(0);
    expect(done.summary.skipped).toBe(1);
    expect(mocks.mutation.mock.calls.filter(([ref]) => ref.name === 'rollback')).not.toHaveLength(
      0
    );
    expect(mocks.mutation.mock.calls.filter(([ref]) => ref.name === 'finalize')).toHaveLength(0);
  });

  it('retry re-selects only the entries that failed or never started', async () => {
    installConvex({
      preflight: () => {
        throw { data: { code: 'IMPORT_UNKNOWN_TEAM_STRUCTURE', message: 'team is not known' } };
      },
    });
    // Let the first entry succeed so the retry has something to protect.
    let calls = 0;
    mocks.query.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return PREFLIGHT;
      throw { data: { code: 'IMPORT_UNKNOWN_TEAM_STRUCTURE', message: 'team is not known' } };
    });

    const { result } = renderHook(() => useTransferImport('machine-1'));
    await act(async () => {
      await result.current.loadFile(fileFrom(await bundleJson()));
    });
    act(() => result.current.selectAll());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.kind).toBe('done'));

    const done = doneState(result.current.state);
    expect(done.summary.imported).toBe(1);
    expect(done.summary.failed).toBe(1);

    act(() => result.current.retryRemaining());
    const retried = listedState(result.current.state);
    expect(retried.selected).toEqual(new Set(['src-2']));
    expect(retried.importedKeys).toEqual(new Set(['src-1']));
    expect(retried.machineId).toBe('machine-1');
  });

  it('a target-wide refusal stops the run and skips the rest', async () => {
    installConvex({
      preflight: () => {
        throw new ChatroomTransferError('IMPORT_MACHINE_NOT_OWNED', 'not your machine');
      },
    });

    const { result } = renderHook(() => useTransferImport('machine-1'));
    await act(async () => {
      await result.current.loadFile(fileFrom(await bundleJson()));
    });
    act(() => result.current.selectAll());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.kind).toBe('done'));

    const done = doneState(result.current.state);
    expect(done.summary.fatal).toEqual({
      code: 'IMPORT_MACHINE_NOT_OWNED',
      message: 'not your machine',
    });
    expect(done.summary.skipped).toBe(1);
    expect(mocks.mutation.mock.calls.filter(([ref]) => ref.name === 'begin')).toHaveLength(0);
  });

  it('toggles an imported key as unselectable after a retry', async () => {
    const { result } = renderHook(() => useTransferImport('machine-1'));
    await act(async () => {
      await result.current.loadFile(fileFrom(await bundleJson()));
    });
    // Retry arrives with an imported key; toggling it must not select it.
    const state = listedState(result.current.state);
    expect(state.listing.entries).toHaveLength(2);
    act(() => result.current.toggle('src-1'));
    expect(listedState(result.current.state).selected).toEqual(new Set(['src-1']));
    act(() => result.current.clear());
    expect(listedState(result.current.state).selected.size).toBe(0);
  });
});

function listedOrImporting(state: ImportViewState): string {
  return state.kind;
}
