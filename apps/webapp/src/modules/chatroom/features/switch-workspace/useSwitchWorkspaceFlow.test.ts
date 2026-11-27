import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSwitchWorkspaceFlow, type SwitchTarget } from './useSwitchWorkspaceFlow';

const mockSwitch = vi.fn();
/** The live workspace the mocked context returns. Tests mutate it to simulate a rebind. */
const mockActive = { current: makeWorkspace('ws_1') };

vi.mock('@/modules/chatroom/context/ChatroomWorkspaceContext', () => ({
  useChatroomWorkspace: () => ({
    activeWorkspace: mockActive.current,
    switchWorkspace: mockSwitch,
  }),
}));

function makeWorkspace(registryId: string) {
  return {
    id: 'm1::/code/app',
    machineId: 'm1',
    hostname: 'laptop',
    machineAlias: undefined,
    workingDir: '/code/app',
    agentRoles: [],
    fileTreeSyncEnabled: true,
    _registryId: registryId,
  };
}

const TARGET: SwitchTarget = {
  machineId: 'm2',
  machineLabel: 'desktop',
  connected: true,
  workingDir: '/srv/app',
};

const SWITCHED = {
  outcome: 'switched',
  workspaceId: 'ws_2',
  machineId: 'm2',
  workingDir: '/srv/app',
  previousWorkspaceIds: ['ws_1'],
  agentsStopRequested: true,
  configsMigrated: ['planner'],
  configsSkipped: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderFlow() {
  return renderHook(() => useSwitchWorkspaceFlow());
}

/** choose → review with the target, acknowledged. */
function startAcknowledgedReview(result: { current: ReturnType<typeof useSwitchWorkspaceFlow> }) {
  act(() => result.current.startReview(TARGET));
  act(() => result.current.setAcknowledged(true));
}

describe('useSwitchWorkspaceFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActive.current = makeWorkspace('ws_1');
    mockSwitch.mockResolvedValue(SWITCHED);
  });

  it('runs choose → review → submitting → done', async () => {
    const pending = deferred<typeof SWITCHED>();
    mockSwitch.mockReturnValue(pending.promise);
    const { result } = renderFlow();

    startAcknowledgedReview(result);
    expect(result.current.stage).toBe('review');
    expect(result.current.from).toEqual({
      registryId: 'ws_1',
      machineId: 'm1',
      machineLabel: 'laptop',
      workingDir: '/code/app',
    });

    let submitDone: Promise<void> | undefined;
    act(() => {
      submitDone = result.current.submit();
    });
    expect(result.current.stage).toBe('submitting');
    expect(result.current.busy).toBe(true);
    expect(mockSwitch).toHaveBeenCalledTimes(1);
    expect(mockSwitch).toHaveBeenCalledWith('m2', '/srv/app');

    await act(async () => {
      pending.resolve(SWITCHED);
      await submitDone;
    });

    expect(result.current.stage).toBe('done');
    expect(result.current.result).toEqual(SWITCHED);
    expect(result.current.busy).toBe(false);
  });

  it('returns to review with a conflict error when the workspace changed server-side', async () => {
    mockSwitch.mockRejectedValue({ data: { code: 'WORKSPACE_SWITCH_CONFLICT' } });
    const { result } = renderFlow();

    startAcknowledgedReview(result);
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.stage).toBe('review');
    expect(result.current.error?.kind).toBe('conflict');
  });

  it('goes stale and refuses to submit when the live workspace id changes', async () => {
    const { result, rerender } = renderFlow();
    startAcknowledgedReview(result);

    mockActive.current = makeWorkspace('ws_2');
    rerender();

    expect(result.current.stale).toBe(true);
    await act(async () => {
      await result.current.submit();
    });

    expect(mockSwitch).not.toHaveBeenCalled();
    expect(result.current.stage).toBe('review');
  });

  it('returns to choose with an invalid-path error', async () => {
    mockSwitch.mockRejectedValue({ data: { code: 'INVALID_WORKING_DIR' } });
    const { result } = renderFlow();

    startAcknowledgedReview(result);
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.stage).toBe('choose');
    expect(result.current.error?.kind).toBe('invalid-path');
  });

  it('ends on done with an unchanged result', async () => {
    mockSwitch.mockResolvedValue({ ...SWITCHED, outcome: 'unchanged' });
    const { result } = renderFlow();

    startAcknowledgedReview(result);
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.stage).toBe('done');
    expect(result.current.result?.outcome).toBe('unchanged');
  });

  it('does not submit before the acknowledgement', async () => {
    const { result } = renderFlow();

    act(() => result.current.startReview(TARGET));
    await act(async () => {
      await result.current.submit();
    });

    expect(mockSwitch).not.toHaveBeenCalled();
    expect(result.current.stage).toBe('review');
  });

  it('reviewCurrent clears the target and returns to choose', () => {
    const { result } = renderFlow();

    startAcknowledgedReview(result);
    act(() => result.current.reviewCurrent());

    expect(result.current.stage).toBe('choose');
    expect(result.current.target).toBeNull();
    expect(result.current.from).toBeNull();
  });
});
