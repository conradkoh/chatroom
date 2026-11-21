import { act, renderHook } from '@testing-library/react';
import type { BulkCreateResult } from '@workspace/backend/src/domain/usecase/chatroom/create-chatrooms-for-working-dirs';
import type { FunctionReference } from 'convex/server';
import { getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBulkCreateChatrooms } from './useBulkCreateChatrooms';

const mocks = vi.hoisted(() => ({
  createMany: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (mutation: unknown) => {
    const name = getFunctionName(mutation as FunctionReference<'mutation'>);
    if (name === 'chatrooms:createManyWithWorkspace') return mocks.createMany;
    throw new Error(`Unexpected mutation: ${name}`);
  },
}));

const CREATED_RESULT: BulkCreateResult = {
  results: [
    {
      workingDir: '/a',
      outcome: 'created',
      chatroomId: 'room-1' as never,
      workspaceId: 'workspace-1' as never,
    },
  ],
  created: 1,
  skipped: 0,
  failed: 0,
};

describe('useBulkCreateChatrooms', () => {
  beforeEach(() => {
    mocks.createMany.mockReset();
  });

  it('createOne calls the mutation with a one-element array and returns its outcome', async () => {
    mocks.createMany.mockResolvedValue(CREATED_RESULT);
    const { result } = renderHook(() => useBulkCreateChatrooms());

    let outcome: Awaited<ReturnType<typeof result.current.createOne>> | undefined;
    await act(async () => {
      outcome = await result.current.createOne('machine-1', '/a');
    });

    expect(mocks.createMany).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDirs: ['/a'],
    });
    expect(outcome).toEqual(CREATED_RESULT.results[0]);
  });

  it('createMany sends the full array unchanged and returns the bulk result', async () => {
    mocks.createMany.mockResolvedValue(CREATED_RESULT);
    const { result } = renderHook(() => useBulkCreateChatrooms());

    let bulk: Awaited<ReturnType<typeof result.current.createMany>> | undefined;
    await act(async () => {
      bulk = await result.current.createMany('machine-1', ['/a', '/b']);
    });

    expect(mocks.createMany).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDirs: ['/a', '/b'],
    });
    expect(bulk).toEqual(CREATED_RESULT);
  });

  it('createOne propagates a rejected mutation', async () => {
    mocks.createMany.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useBulkCreateChatrooms());

    await act(async () => {
      await expect(result.current.createOne('machine-1', '/a')).rejects.toThrow('boom');
    });
  });
});
