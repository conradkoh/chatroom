import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMachineExportAction } from './useMachineExportAction';

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

/** The query calls the export made to `listForMachine`, in order. */
function listForMachineCalls(): unknown[] {
  return mocks.query.mock.calls.filter(
    ([ref]) => (ref as { name?: string } | undefined)?.name === 'listForMachine'
  );
}

describe('useMachineExportAction', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.downloadBlobFile.mockReset();
  });

  it('ignores a second start() while the first export is still running', async () => {
    // The listing never answers, so the first run stays in flight for the whole test.
    mocks.query.mockImplementation((ref: { name?: string }) => {
      if (ref.name === 'listForMachine') return new Promise(() => {});
      throw new Error(`Unexpected query: ${ref.name}`);
    });

    const { result } = renderHook(() => useMachineExportAction('machine-1'));

    act(() => {
      result.current.start();
    });
    await waitFor(() => expect(listForMachineCalls()).toHaveLength(1));

    act(() => {
      result.current.start();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(listForMachineCalls()).toHaveLength(1);
  });
});
