import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';

import { act, renderHook } from '@testing-library/react';
import { exportFileName } from '@workspace/backend/src/domain/entities/chatroom-transfer-file-name';
import {
  runExport,
  type ChatroomExportPort,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-driver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatroomExport } from './useChatroomExport';
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

const CHATROOM_ID = 'chr-1';
const AT = new Date('2026-01-02T03:04:05.000Z');
const ATTACHMENT_BYTES = 4_404_019;

const STAMP = {
  lastActivityAt: null,
  nextQueuePosition: null,
  latestMessage: null,
  taskCounts: null,
  latest: {},
  attachmentRows: { count: 2, capped: false, totalBytes: ATTACHMENT_BYTES },
};

const ROOM_ROW = {
  id: 'room-1',
  creationTime: 1,
  fields: { status: 'active', name: 'Planning room', teamStructureId: 'duo' },
};

const MESSAGE_ROW = {
  id: 'message-1',
  creationTime: 2,
  fields: {
    senderRole: 'user',
    content: 'hello',
    type: 'message',
    attachedFileIds: ['file-1', 'file-2'],
  },
};

type Row = { id: string; creationTime: number; fields: Record<string, unknown> };
type Page = { rows: Row[]; continueCursor: null; isDone: true };

function page(rows: Row[]): Page {
  return { rows, continueCursor: null, isDone: true };
}

function pageFor(category: string): Page {
  if (category === 'room') return page([ROOM_ROW]);
  if (category === 'messages') return page([MESSAGE_ROW]);
  return page([]);
}

const PORT: ChatroomExportPort = {
  getStamp: async () => STAMP,
  readPage: async ({ category }) => pageFor(category),
};

function installQueries(): void {
  mocks.query.mockImplementation(async (ref: { name?: string }, args: { category?: string }) => {
    if (ref.name === 'getStamp') return STAMP;
    if (ref.name === 'readPage') return pageFor(args.category ?? '');
    throw new Error(`Unexpected query: ${ref.name}`);
  });
}

describe('useChatroomExport', () => {
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

  it('saves the CLI-equivalent bytes under the CLI file name', async () => {
    const { result } = renderHook(() => useChatroomExport());
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;

    await act(async () => {
      outcome = await result.current.run(CHATROOM_ID);
    });

    expect(outcome).toMatchObject({
      ok: true,
      fileName: exportFileName(CHATROOM_ID, AT),
      omitted: { count: 2, bytes: ATTACHMENT_BYTES },
    });
    expect(mocks.downloadBlobFile).toHaveBeenCalledTimes(1);
    const [fileName, blob] = mocks.downloadBlobFile.mock.calls[0] as [string, Blob];
    expect(fileName).toBe(exportFileName(CHATROOM_ID, AT));

    const saved = await blob.text();
    const direct = await runExport(PORT, {
      chatroomId: CHATROOM_ID,
      cliVersion: WEB_EXPORT_SOURCE_VERSION,
      now: () => AT,
    });
    expect(saved).toBe(direct.json);

    const parsed = JSON.parse(saved);
    expect(parsed.kind).toBe('chatroom-export');
    expect(parsed.source).toEqual({ chatroomId: CHATROOM_ID, cliVersion: 'webapp' });
    expect(parsed.omitted.chatroom_fileAttachments).toMatchObject({
      count: 2,
      bytes: ATTACHMENT_BYTES,
    });
    expect(parsed.messages[0]).not.toHaveProperty('attachedFileIds');
  });

  it('reports a Convex failure without saving a file', async () => {
    mocks.query.mockRejectedValueOnce({
      data: { code: 'EXPORT_CHATROOM_CHANGED', message: 'changed' },
    });
    const { result } = renderHook(() => useChatroomExport());
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;

    await act(async () => {
      outcome = await result.current.run(CHATROOM_ID);
    });

    expect(outcome).toEqual({
      ok: false,
      failure: { code: 'EXPORT_CHATROOM_CHANGED', message: 'changed', details: [] },
    });
    expect(mocks.downloadBlobFile).not.toHaveBeenCalled();
  });
});
