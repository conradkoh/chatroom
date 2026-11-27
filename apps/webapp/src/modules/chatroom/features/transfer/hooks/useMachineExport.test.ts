import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import { ChatroomTransferError } from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import { bundleFileName } from '@workspace/backend/src/domain/entities/chatroom-transfer-file-name';
import { runExportBundle } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-bundle';
import type { ExportableChatroom } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-list';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMachineExport } from './useMachineExport';
import { WEB_EXPORT_SOURCE_VERSION } from '../lib/convexTransferPorts';

const mocks = vi.hoisted(() => ({ query: vi.fn(), downloadBlobFile: vi.fn() }));

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mocks.query }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatroomExport: {
      getStamp: { name: 'getStamp' },
      readPage: { name: 'readPage' },
      listForMachine: { name: 'listForMachine' },
    },
  },
}));

vi.mock('@/modules/chatroom/lib/messageExport/downloadTextFile', () => ({
  downloadBlobFile: mocks.downloadBlobFile,
}));

const MACHINE_ID = 'machine-1';
const AT = new Date('2026-01-02T03:04:05.000Z');

const ROWS: ExportableChatroom[] = [
  { chatroomId: 'c1' as ExportableChatroom['chatroomId'], name: 'Alpha', status: 'active' },
  { chatroomId: 'c2' as ExportableChatroom['chatroomId'], name: 'Beta', status: 'completed' },
];

type Row = { id: string; creationTime: number; fields: Record<string, unknown> };
type Page = { rows: Row[]; continueCursor: null; isDone: true };

function page(rows: Row[]): Page {
  return { rows, continueCursor: null, isDone: true };
}

function stampFor(chatroomId: string) {
  return {
    lastActivityAt: null,
    nextQueuePosition: null,
    latestMessage: null,
    taskCounts: null,
    latest: {},
    attachmentRows: { count: 1, capped: false, totalBytes: 1024 },
    chatroomId,
  };
}

function pageFor(chatroomId: string, category: string): Page {
  if (category === 'room') {
    return page([
      {
        id: `${chatroomId}-room`,
        creationTime: 1,
        fields: { status: 'active', name: `Room ${chatroomId}`, teamStructureId: 'duo' },
      },
    ]);
  }
  if (category === 'messages') {
    return page([
      {
        id: `${chatroomId}-message`,
        creationTime: 2,
        fields: { senderRole: 'user', content: 'hello', type: 'message' },
      },
    ]);
  }
  return page([]);
}

function installQueries(): void {
  mocks.query.mockImplementation(
    async (ref: { name?: string }, args: { chatroomId?: string; category?: string }) => {
      if (ref.name === 'listForMachine') return ROWS;
      if (ref.name === 'getStamp') return stampFor(args.chatroomId ?? '');
      if (ref.name === 'readPage') return pageFor(args.chatroomId ?? '', args.category ?? '');
      throw new Error(`Unexpected query: ${ref.name}`);
    }
  );
}

describe('useMachineExport', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT);
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('Blob', NodeBlob);
    mocks.query.mockReset();
    mocks.downloadBlobFile.mockReset();
    installQueries();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('moves from listing to exporting, then saves the CLI-equivalent bundle once', async () => {
    let releaseList: (rows: ExportableChatroom[]) => void = () => {};
    const listGate = new Promise<ExportableChatroom[]>((resolve) => {
      releaseList = resolve;
    });
    let releaseStamp: () => void = () => {};
    const stampGate = new Promise<void>((resolve) => {
      releaseStamp = resolve;
    });
    let gateStamp = true;
    mocks.query.mockImplementation(
      async (ref: { name?: string }, args: { chatroomId?: string; category?: string }) => {
        if (ref.name === 'listForMachine') return listGate;
        if (ref.name === 'getStamp') {
          if (gateStamp) {
            gateStamp = false;
            await stampGate;
          }
          return stampFor(args.chatroomId ?? '');
        }
        if (ref.name === 'readPage') return pageFor(args.chatroomId ?? '', args.category ?? '');
        throw new Error(`Unexpected query: ${ref.name}`);
      }
    );

    const { result } = renderHook(() => useMachineExport(MACHINE_ID));
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;

    const holder: { pending?: Promise<Awaited<ReturnType<typeof result.current.run>>> } = {};
    act(() => {
      holder.pending = result.current.run();
    });
    await waitFor(() => expect(result.current.state).toEqual({ kind: 'listing' }));
    releaseList(ROWS);
    await waitFor(() =>
      expect(result.current.state).toEqual({ kind: 'exporting', done: 0, total: 2 })
    );
    releaseStamp();
    const pending = holder.pending;
    if (!pending) throw new Error('export did not start');
    await act(async () => {
      outcome = await pending;
    });

    expect(outcome).toMatchObject({
      ok: true,
      fileName: bundleFileName(MACHINE_ID, AT),
      chatroomCount: 2,
      omitted: { count: 2, bytes: 2048 },
    });
    expect(mocks.downloadBlobFile).toHaveBeenCalledTimes(1);
    const [fileName, blob] = mocks.downloadBlobFile.mock.calls[0] as [string, Blob];
    expect(fileName).toBe(bundleFileName(MACHINE_ID, AT));

    const saved = await blob.text();
    const direct = await runExportBundle(
      {
        getStamp: async (chatroomId) => stampFor(chatroomId),
        readPage: async ({ chatroomId, category }) => pageFor(chatroomId, category),
      },
      {
        chatroomIds: ROWS.map((row) => row.chatroomId),
        machineId: MACHINE_ID,
        cliVersion: WEB_EXPORT_SOURCE_VERSION,
        now: () => AT,
      }
    );
    expect(saved).toBe(direct.json);

    const parsed = JSON.parse(saved);
    expect(parsed.kind).toBe('chatroom-export-bundle');
    expect(parsed.source).toEqual({ machineId: MACHINE_ID, cliVersion: 'webapp' });
    expect(parsed.chatrooms).toHaveLength(2);
    expect(
      parsed.chatrooms.map((room: { source: { chatroomId: string } }) => room.source.chatroomId)
    ).toEqual(['c1', 'c2']);
    expect(parsed.index).toHaveLength(2);
  });

  it('cancels without saving a file', async () => {
    const { result } = renderHook(() => useMachineExport(MACHINE_ID));
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;

    await act(async () => {
      const pending = result.current.run();
      result.current.cancel();
      outcome = await pending;
    });

    expect(outcome).toEqual({ ok: false, cancelled: true });
    expect(mocks.downloadBlobFile).not.toHaveBeenCalled();
  });

  it('reports an empty machine without reading or bundling chatrooms', async () => {
    mocks.query.mockImplementation(async (ref: { name?: string }) => {
      if (ref.name === 'listForMachine') return [];
      throw new Error(`Unexpected query: ${ref.name}`);
    });
    const { result } = renderHook(() => useMachineExport(MACHINE_ID));
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;

    await act(async () => {
      outcome = await result.current.run();
    });

    expect(outcome).toEqual({ ok: true, empty: true });
    expect(mocks.query.mock.calls.map(([ref]) => (ref as { name: string }).name)).toEqual([
      'listForMachine',
    ]);
    expect(mocks.downloadBlobFile).not.toHaveBeenCalled();
  });

  it('reports the names of the failed chatrooms and saves nothing', async () => {
    mocks.query.mockImplementation(
      async (ref: { name?: string }, args: { chatroomId?: string; category?: string }) => {
        if (ref.name === 'listForMachine') return ROWS;
        if (ref.name === 'getStamp') {
          if (args.chatroomId === 'c2') {
            throw { data: { code: 'EXPORT_CHATROOM_CHANGED', message: 'changed' } };
          }
          return stampFor(args.chatroomId ?? '');
        }
        if (ref.name === 'readPage') return pageFor(args.chatroomId ?? '', args.category ?? '');
        throw new Error(`Unexpected query: ${ref.name}`);
      }
    );
    const { result } = renderHook(() => useMachineExport(MACHINE_ID));
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;

    await act(async () => {
      outcome = await result.current.run();
    });

    expect(outcome).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'EXPORT_ALL_INCOMPLETE' }),
      failed: [{ chatroomId: 'c2', name: 'Beta' }],
      total: 2,
    });
    expect(mocks.downloadBlobFile).not.toHaveBeenCalled();
  });

  it('stops immediately on EXPORT_TOO_LARGE', async () => {
    mocks.query.mockImplementation(
      async (ref: { name?: string }, args: { chatroomId?: string; category?: string }) => {
        if (ref.name === 'listForMachine') return ROWS;
        if (ref.name === 'getStamp') {
          if (args.chatroomId === 'c1') {
            throw new ChatroomTransferError('EXPORT_TOO_LARGE', 'too large');
          }
          return stampFor(args.chatroomId ?? '');
        }
        if (ref.name === 'readPage') return pageFor(args.chatroomId ?? '', args.category ?? '');
        throw new Error(`Unexpected query: ${ref.name}`);
      }
    );
    const { result } = renderHook(() => useMachineExport(MACHINE_ID));
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;

    await act(async () => {
      outcome = await result.current.run();
    });

    expect(outcome).toEqual({
      ok: false,
      failure: { code: 'EXPORT_TOO_LARGE', message: 'too large', details: [] },
      failed: [],
      total: 2,
    });
    expect(mocks.downloadBlobFile).not.toHaveBeenCalled();
  });

  it('maps a listing refusal before any chatroom is read', async () => {
    mocks.query.mockImplementation(async (ref: { name?: string }) => {
      if (ref.name === 'listForMachine') {
        throw { data: { code: 'EXPORT_MACHINE_TOO_LARGE', message: 'too many workspaces' } };
      }
      throw new Error(`Unexpected query: ${ref.name}`);
    });
    const { result } = renderHook(() => useMachineExport(MACHINE_ID));
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;

    await act(async () => {
      outcome = await result.current.run();
    });

    expect(outcome).toEqual({
      ok: false,
      failure: {
        code: 'EXPORT_MACHINE_TOO_LARGE',
        message: 'too many workspaces',
        details: [],
      },
      failed: [],
      total: 0,
    });
    expect(mocks.downloadBlobFile).not.toHaveBeenCalled();
  });
});
