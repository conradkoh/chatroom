import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import {
  setCustomAgentDisabled,
  type CustomAgentsToggleClient,
  type ToggleCustomAgentDeps,
} from './enable-disable.js';

interface RosterEntry {
  role: string;
  source: 'custom' | 'builtin';
  disabled: boolean;
  disableable: boolean;
}

/** A clock whose `sleep` advances `now`, so the poll never waits in real time. */
function createClock() {
  let time = 0;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    sleeps,
  };
}

/**
 * A fake backend. `rosterValues` is the `disabled` value the roster reports for
 * `alpha`, one entry per query; the last entry repeats.
 */
function createClient(options: {
  rosterValues?: readonly boolean[] | undefined;
  mutationError?: unknown;
}) {
  const mutations: { name: string; disabled: boolean }[] = [];
  let queryCount = 0;
  const values = options.rosterValues ?? [false];
  const client: CustomAgentsToggleClient = {
    query: async () => {
      const index = Math.min(queryCount, values.length - 1);
      queryCount += 1;
      return {
        roster: [
          {
            role: 'alpha',
            source: 'custom',
            disabled: values[index],
            disableable: true,
          } satisfies RosterEntry,
        ],
      };
    },
    mutation: async (_endpoint, args) => {
      const typed = args as { name: string; disabled: boolean };
      mutations.push({ name: typed.name, disabled: typed.disabled });
      if (options.mutationError !== undefined) throw options.mutationError;
      return { queued: true };
    },
  };
  return { client, mutations, queries: () => queryCount };
}

function createDeps(client: CustomAgentsToggleClient) {
  const lines: string[] = [];
  const exitCodes: number[] = [];
  const clock = createClock();
  const deps: ToggleCustomAgentDeps = {
    client,
    sessionId: 'session-1',
    stdout: (line) => lines.push(line),
    setExitCode: (code) => exitCodes.push(code),
    now: clock.now,
    sleep: clock.sleep,
  };
  return { deps, lines, exitCodes, clock };
}

describe('setCustomAgentDisabled', () => {
  it('sends an absolute disable and confirms it from the roster', async () => {
    const fake = createClient({ rosterValues: [false, true] });
    const harness = createDeps(fake.client);

    await setCustomAgentDisabled('chatroom-1', 'alpha', true, harness.deps);

    expect(fake.mutations).toEqual([{ name: 'alpha', disabled: true }]);
    expect(harness.lines).toEqual(['confirmed']);
    expect(harness.exitCodes).toEqual([]);
  });

  it('sends an absolute enable and confirms it from the roster', async () => {
    const fake = createClient({ rosterValues: [true, false] });
    const harness = createDeps(fake.client);

    await setCustomAgentDisabled('chatroom-1', 'alpha', false, harness.deps);

    expect(fake.mutations).toEqual([{ name: 'alpha', disabled: false }]);
    expect(harness.lines).toEqual(['confirmed']);
  });

  it('polls once a second and reports a timeout after ten seconds', async () => {
    const fake = createClient({ rosterValues: [false] });
    const harness = createDeps(fake.client);

    await setCustomAgentDisabled('chatroom-1', 'alpha', true, harness.deps);

    expect(harness.lines).toEqual([
      'timed out waiting for the daemon; the change is still pending',
    ]);
    expect(harness.exitCodes).toEqual([1]);
    expect(fake.queries()).toBe(11);
    expect(harness.clock.sleeps).toEqual(Array.from({ length: 10 }, () => 1_000));
  });

  it('rejects a malformed name before any backend call', async () => {
    const fake = createClient({ rosterValues: [true] });
    const harness = createDeps(fake.client);

    await setCustomAgentDisabled('chatroom-1', 'Bad_Name', true, harness.deps);

    expect(fake.mutations).toEqual([]);
    expect(fake.queries()).toBe(0);
    expect(harness.lines[0]).toContain('Invalid custom agent name "Bad_Name"');
    expect(harness.exitCodes).toEqual([1]);
  });

  it('surfaces the backend error for a builtin role name', async () => {
    // `planner` is a reserved name, not a malformed one: the CLI must ask the
    // backend and print its message rather than keep a builtin list.
    const error = new ConvexError({
      code: 'CUSTOM_AGENT_NOT_FOUND',
      message: 'Custom agent "planner" was not found',
    });
    const fake = createClient({ mutationError: error });
    const harness = createDeps(fake.client);

    await setCustomAgentDisabled('chatroom-1', 'planner', true, harness.deps);

    expect(fake.mutations).toEqual([{ name: 'planner', disabled: true }]);
    expect(harness.lines).toEqual(['Custom agent "planner" was not found']);
    expect(harness.exitCodes).toEqual([1]);
    expect(fake.queries()).toBe(0);
  });
});
