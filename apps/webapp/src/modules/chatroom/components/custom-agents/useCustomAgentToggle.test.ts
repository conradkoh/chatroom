import { act, renderHook } from '@testing-library/react';
import { CUSTOM_AGENT_LIMITS } from '@workspace/shared/domain/custom-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOM_AGENT_OVER_LIMIT_MESSAGE,
  CUSTOM_AGENT_TOGGLE_TIMEOUT_MESSAGE,
} from './customAgentCopy';
import type { CustomAgentRowModel } from './customAgentsViewModel';
import { useCustomAgentToggle } from './useCustomAgentToggle';

/** The hook's confirmation window; duplicated here because it is module-private. */
const CUSTOM_AGENT_TOGGLE_TIMEOUT_MS = 10_000;

/** No agent is past the chatroom cap. */
const NO_OVER_LIMIT: ReadonlySet<string> = new Set();

const mockSetDisabled = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockSetDisabled,
}));

function row(name: string, disabled = false): CustomAgentRowModel {
  return {
    name,
    description: `${name} summary`,
    scope: 'workspace',
    disabled,
    disableable: true,
    overridesMachineCopy: false,
  };
}

interface ToggleHookProps {
  rows: CustomAgentRowModel[];
  overLimit?: ReadonlySet<string>;
}

function renderToggle(initialRows: CustomAgentRowModel[]) {
  return renderHook(
    ({ rows, overLimit }: ToggleHookProps) =>
      useCustomAgentToggle({
        chatroomId: 'chatroom-1',
        rows,
        overLimitNames: overLimit ?? NO_OVER_LIMIT,
      }),
    { initialProps: { rows: initialRows } as ToggleHookProps }
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  mockSetDisabled.mockReset();
  mockSetDisabled.mockResolvedValue({ queued: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCustomAgentToggle', () => {
  it('sends one mutation for a double request while pending', () => {
    const { result } = renderToggle([row('alpha')]);

    act(() => result.current.requestToggle('alpha', true));
    act(() => result.current.requestToggle('alpha', true));

    expect(mockSetDisabled).toHaveBeenCalledTimes(1);
    expect(mockSetDisabled).toHaveBeenCalledWith({
      chatroomId: 'chatroom-1',
      name: 'alpha',
      disabled: true,
    });
    expect(result.current.stateFor('alpha')).toMatchObject({
      kind: 'pending',
      desiredDisabled: true,
    });
  });

  it('clears the timer when the roster confirms the change', () => {
    const { result, rerender } = renderToggle([row('alpha')]);
    act(() => result.current.requestToggle('alpha', true));

    rerender({ rows: [row('alpha', true)] });

    expect(result.current.stateFor('alpha')).toEqual({ kind: 'idle' });
    act(() => vi.advanceTimersByTime(CUSTOM_AGENT_TOGGLE_TIMEOUT_MS));
    expect(result.current.stateFor('alpha')).toEqual({ kind: 'idle' });
  });

  it('fails with the timeout copy when the roster never confirms', () => {
    mockSetDisabled.mockReturnValue(new Promise(() => undefined));
    const { result } = renderToggle([row('alpha')]);
    act(() => result.current.requestToggle('alpha', true));

    act(() => vi.advanceTimersByTime(CUSTOM_AGENT_TOGGLE_TIMEOUT_MS));

    expect(result.current.stateFor('alpha')).toEqual({
      kind: 'failed',
      desiredDisabled: true,
      message: CUSTOM_AGENT_TOGGLE_TIMEOUT_MESSAGE,
    });
  });

  it('clears a failure when the roster catches up later', () => {
    mockSetDisabled.mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = renderToggle([row('alpha')]);
    act(() => result.current.requestToggle('alpha', true));
    act(() => vi.advanceTimersByTime(CUSTOM_AGENT_TOGGLE_TIMEOUT_MS));
    expect(result.current.stateFor('alpha')).toMatchObject({ kind: 'failed' });

    rerender({ rows: [row('alpha', true)] });

    expect(result.current.stateFor('alpha')).toEqual({ kind: 'idle' });
  });

  it('ignores a rejection from a stale request id', async () => {
    let rejectFirst: ((error: unknown) => void) | undefined;
    mockSetDisabled.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        })
    );
    const { result, rerender } = renderToggle([row('alpha')]);

    act(() => result.current.requestToggle('alpha', true));
    rerender({ rows: [row('alpha', true)] });
    expect(result.current.stateFor('alpha')).toEqual({ kind: 'idle' });

    mockSetDisabled.mockResolvedValueOnce({ queued: true });
    act(() => result.current.requestToggle('alpha', false));

    await act(async () => {
      rejectFirst?.(new Error('late failure'));
      await Promise.resolve();
    });

    expect(result.current.stateFor('alpha')).toMatchObject({
      kind: 'pending',
      desiredDisabled: false,
    });
  });

  it('drops state for a row that leaves the roster', () => {
    mockSetDisabled.mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = renderToggle([row('alpha')]);
    act(() => result.current.requestToggle('alpha', true));

    rerender({ rows: [] });

    expect(result.current.stateFor('alpha')).toEqual({ kind: 'idle' });
    act(() => vi.advanceTimersByTime(CUSTOM_AGENT_TOGGLE_TIMEOUT_MS));
    expect(result.current.stateFor('alpha')).toEqual({ kind: 'idle' });
  });

  it('clears every timer on unmount', () => {
    const clearSpy = vi.spyOn(window, 'clearTimeout');
    mockSetDisabled.mockReturnValue(new Promise(() => undefined));
    const { result, unmount } = renderToggle([row('alpha')]);
    act(() => result.current.requestToggle('alpha', true));

    unmount();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe('useCustomAgentToggle over-limit enables', () => {
  /** A roster at exactly the per-chatroom cap, plus the disabled agent asking for a slot. */
  function cappedRows(): CustomAgentRowModel[] {
    const enabled = Array.from({ length: CUSTOM_AGENT_LIMITS.agentsPerChatroom }, (_, index) =>
      row(`agent-${index + 1}`)
    );
    return [...enabled, row('agent-17', true)];
  }

  function withoutAgent17(rows: CustomAgentRowModel[]): CustomAgentRowModel[] {
    return rows.filter((entry) => entry.name !== 'agent-17');
  }

  it('keeps a failed state when the cap drops the row instead of resetting to idle', () => {
    mockSetDisabled.mockReturnValue(new Promise(() => undefined));
    const rows = cappedRows();
    const { result, rerender } = renderToggle(rows);

    act(() => result.current.requestToggle('agent-17', false));
    rerender({ rows: withoutAgent17(rows), overLimit: new Set(['agent-17']) });

    expect(result.current.stateFor('agent-17')).toEqual({
      kind: 'failed',
      desiredDisabled: false,
      message: CUSTOM_AGENT_OVER_LIMIT_MESSAGE,
    });
  });

  it('resets to idle once the over-limit issue clears', () => {
    mockSetDisabled.mockReturnValue(new Promise(() => undefined));
    const rows = cappedRows();
    const { result, rerender } = renderToggle(rows);
    act(() => result.current.requestToggle('agent-17', false));
    rerender({ rows: withoutAgent17(rows), overLimit: new Set(['agent-17']) });
    expect(result.current.stateFor('agent-17')).toMatchObject({ kind: 'failed' });

    rerender({
      rows: [...rows.filter((entry) => entry.name !== 'agent-17'), row('agent-17')],
      overLimit: NO_OVER_LIMIT,
    });

    expect(result.current.stateFor('agent-17')).toEqual({ kind: 'idle' });
  });
});
