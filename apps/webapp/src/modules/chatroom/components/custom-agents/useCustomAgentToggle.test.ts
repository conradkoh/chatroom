import { act, renderHook } from '@testing-library/react';
import {
  CUSTOM_AGENT_LIMITS,
  mergeTeamStructureWithCustomAgents,
} from '@workspace/shared/domain/custom-agent';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOM_AGENT_DISPLACED_MESSAGE,
  CUSTOM_AGENT_OVER_LIMIT_MESSAGE,
  CUSTOM_AGENT_TOGGLE_TIMEOUT_MESSAGE,
} from './customAgentCopy';
import {
  buildCustomAgentsViewModel,
  overLimitNames,
  type CustomAgentRowModel,
  type TeamRosterResult,
} from './customAgentsViewModel';
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
  /** Sixteen agents, all on, is exactly the per-chatroom cap. */
  const AT_CAP = Array.from(
    { length: CUSTOM_AGENT_LIMITS.agentsPerChatroom },
    (_, index) => `agent-${index + 1}`
  );

  /**
   * The roster the backend would serve, built through the real merge so the cap
   * removes the agent it really removes. `agent-17` sorts before `agent-2`
   * through `agent-9`, so enabling it keeps `agent-17` and cuts `agent-9`.
   */
  function rosterFor(
    names: readonly string[],
    disabled: readonly string[]
  ): { rows: CustomAgentRowModel[]; overLimit: ReadonlySet<string> } {
    const merged = mergeTeamStructureWithCustomAgents({
      base: getTeamStructure({ teamId: 'duo' }),
      workspaceAgents: names.map((name) => ({
        name,
        description: `${name} summary`,
        scope: 'workspace' as const,
      })),
      machineAgents: [],
      disabledRoles: new Set(disabled),
    });
    const result: TeamRosterResult = {
      roster: merged.roster,
      sources: [
        {
          scope: 'workspace',
          workingDir: '/repo',
          machineId: 'machine-1',
          agentCount: names.length,
          issues: merged.issues,
          updatedAt: 1,
        },
        { scope: 'machine', machineId: 'machine-1', agentCount: 0, issues: [], updatedAt: 1 },
      ],
    };
    const model = buildCustomAgentsViewModel(result, '/repo');
    return { rows: model.rows, overLimit: overLimitNames(model.sources) };
  }

  const ENABLE_AGENT_17 = [...AT_CAP, 'agent-17'];
  const BEFORE = rosterFor(ENABLE_AGENT_17, ['agent-17']);
  const AFTER = rosterFor(ENABLE_AGENT_17, []);

  it('cuts agent-9, not agent-17, when agent-17 is enabled', () => {
    // Guards the fixture: the real merge keeps agent-17 and displaces agent-9.
    expect(BEFORE.overLimit.size).toBe(0);
    expect(AFTER.overLimit).toEqual(new Set(['agent-9']));
    expect(AFTER.rows.map((row) => row.name)).not.toContain('agent-9');
    expect(AFTER.rows.map((row) => row.name)).toContain('agent-17');
  });

  it('keeps the displaced agent visible instead of dropping it silently', () => {
    mockSetDisabled.mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = renderToggle(BEFORE.rows);

    act(() => result.current.requestToggle('agent-17', false));
    rerender({ rows: AFTER.rows, overLimit: AFTER.overLimit });

    expect(result.current.stateFor('agent-9')).toEqual({
      kind: 'failed',
      desiredDisabled: false,
      message: CUSTOM_AGENT_DISPLACED_MESSAGE,
    });
    // The agent the user toggled did join, so it carries no message.
    expect(result.current.stateFor('agent-17')).toEqual({ kind: 'idle' });
  });

  it('keeps the displaced copy across roster updates with fresh identities', () => {
    // Every roster push rebuilds `rows` and `overLimitNames` from Convex. The
    // displaced agent was never toggled, so no newer roster may turn its copy
    // into the enable failure ("Turned on, but…").
    const initial = rosterFor(ENABLE_AGENT_17, []);
    const { result, rerender } = renderToggle(initial.rows);

    const firstCap = rosterFor(ENABLE_AGENT_17, []);
    rerender({ rows: firstCap.rows, overLimit: firstCap.overLimit });
    expect(result.current.stateFor('agent-9')).toMatchObject({ kind: 'failed' });

    for (let update = 0; update < 3; update += 1) {
      const fresh = rosterFor(ENABLE_AGENT_17, []);
      rerender({ rows: fresh.rows, overLimit: fresh.overLimit });

      const state = result.current.stateFor('agent-9');
      expect(state).toEqual({
        kind: 'failed',
        desiredDisabled: false,
        message: CUSTOM_AGENT_DISPLACED_MESSAGE,
      });
    }
  });

  it('keeps the toggled copy when the cap cuts the toggled agent itself', () => {
    // `zeta` sorts after every `agent-*` name, so this enable is the one cut.
    const names = [...AT_CAP, 'zeta'];
    const before = rosterFor(names, ['zeta']);
    const after = rosterFor(names, []);
    expect(after.overLimit).toEqual(new Set(['zeta']));

    mockSetDisabled.mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = renderToggle(before.rows);

    act(() => result.current.requestToggle('zeta', false));
    rerender({ rows: after.rows, overLimit: after.overLimit });

    expect(result.current.stateFor('zeta')).toEqual({
      kind: 'failed',
      desiredDisabled: false,
      message: CUSTOM_AGENT_OVER_LIMIT_MESSAGE,
    });

    // A later push that keeps the row absent but no longer reports the issue
    // (the folder was deleted) has nothing left to confirm, so the intent resets.
    const deleted = rosterFor(AT_CAP, []);
    expect(deleted.overLimit.size).toBe(0);
    rerender({ rows: deleted.rows, overLimit: deleted.overLimit });

    expect(result.current.stateFor('zeta')).toEqual({ kind: 'idle' });
  });

  it('clears a stale displaced copy once the displaced agent returns to the roster', () => {
    // The cap cut `agent-9`, then someone turned it off outside the tab. A present
    // row means the cap no longer cuts it, so the displaced copy is stale.
    mockSetDisabled.mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = renderToggle(BEFORE.rows);
    act(() => result.current.requestToggle('agent-17', false));
    rerender({ rows: AFTER.rows, overLimit: AFTER.overLimit });
    expect(result.current.stateFor('agent-9')).toEqual({
      kind: 'failed',
      desiredDisabled: false,
      message: CUSTOM_AGENT_DISPLACED_MESSAGE,
    });

    const returned = rosterFor(ENABLE_AGENT_17, ['agent-9']);
    expect(returned.rows.map((row) => row.name)).toContain('agent-9');
    expect(returned.rows.find((row) => row.name === 'agent-9')?.disabled).toBe(true);
    expect(returned.overLimit.size).toBe(0);
    rerender({ rows: returned.rows, overLimit: returned.overLimit });

    expect(result.current.stateFor('agent-9')).toEqual({ kind: 'idle' });
  });

  it('clears a stale over-limit copy once the toggled agent returns to the roster', () => {
    // The cap cut `zeta`'s enable, then someone turned `zeta` off outside the tab:
    // the row is back, so the enable failure no longer applies.
    const names = [...AT_CAP, 'zeta'];
    const before = rosterFor(names, ['zeta']);
    const capped = rosterFor(names, []);
    expect(capped.overLimit).toEqual(new Set(['zeta']));

    mockSetDisabled.mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = renderToggle(before.rows);
    act(() => result.current.requestToggle('zeta', false));
    rerender({ rows: capped.rows, overLimit: capped.overLimit });
    expect(result.current.stateFor('zeta')).toEqual({
      kind: 'failed',
      desiredDisabled: false,
      message: CUSTOM_AGENT_OVER_LIMIT_MESSAGE,
    });

    const returned = rosterFor(names, ['zeta']);
    expect(returned.rows.map((row) => row.name)).toContain('zeta');
    expect(returned.rows.find((row) => row.name === 'zeta')?.disabled).toBe(true);
    rerender({ rows: returned.rows, overLimit: returned.overLimit });

    expect(result.current.stateFor('zeta')).toEqual({ kind: 'idle' });
  });

  it('keeps a timeout failure on a present row until the roster confirms it', () => {
    // Clearing stale over-limit copies must not generalise: a present row that still
    // disagrees with the intent keeps its failure, whatever its message.
    mockSetDisabled.mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = renderToggle([row('alpha')]);
    act(() => result.current.requestToggle('alpha', true));
    act(() => vi.advanceTimersByTime(CUSTOM_AGENT_TOGGLE_TIMEOUT_MS));
    expect(result.current.stateFor('alpha')).toMatchObject({
      kind: 'failed',
      message: CUSTOM_AGENT_TOGGLE_TIMEOUT_MESSAGE,
    });

    rerender({ rows: [row('alpha')] });

    expect(result.current.stateFor('alpha')).toEqual({
      kind: 'failed',
      desiredDisabled: true,
      message: CUSTOM_AGENT_TOGGLE_TIMEOUT_MESSAGE,
    });
  });

  it('resets the displaced agent to idle once a slot frees', () => {
    mockSetDisabled.mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = renderToggle(BEFORE.rows);
    act(() => result.current.requestToggle('agent-17', false));
    rerender({ rows: AFTER.rows, overLimit: AFTER.overLimit });
    expect(result.current.stateFor('agent-9')).toMatchObject({ kind: 'failed' });

    // Turning another agent off frees the slot, so agent-9 joins and the issue clears.
    const freed = rosterFor(ENABLE_AGENT_17, ['agent-1']);
    rerender({ rows: freed.rows, overLimit: freed.overLimit });

    expect(result.current.stateFor('agent-9')).toEqual({ kind: 'idle' });
  });
});
