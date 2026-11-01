import {
  CUSTOM_AGENT_LIMITS,
  mergeTeamStructureWithCustomAgents,
} from '@workspace/shared/domain/custom-agent';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
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

/** Sixteen agents, all on, is exactly the per-chatroom cap. */
const AT_CAP = Array.from(
  { length: CUSTOM_AGENT_LIMITS.agentsPerChatroom },
  (_, index) => `agent-${index + 1}`
);

/**
 * The custom rows the backend would serve for these agents, built through the
 * real merge. `agent-17` sorts before `agent-2` through `agent-9`, so enabling it
 * keeps `agent-17` and cuts `agent-9`.
 */
function mergedRoster(
  names: readonly string[],
  disabled: readonly string[]
): { roster: RosterEntry[]; issues: { path: string; reason: string }[] } {
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
  const custom = merged.roster.filter((entry) => entry.source === 'custom');
  return {
    roster: custom.map((entry) => ({
      role: entry.role,
      source: 'custom',
      disabled: entry.disabled,
      disableable: entry.disableable,
    })),
    issues: merged.issues.map((issue) => ({ path: issue.path, reason: issue.reason })),
  };
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
  issues?: readonly { path: string; reason: string; detail?: string }[] | undefined;
  /** Drop the agent's roster row, as the backend does for over-limit agents. */
  omitRosterRow?: boolean | undefined;
  /** Full custom roster to report instead of the synthetic `alpha` row. */
  roster?: readonly RosterEntry[] | undefined;
}) {
  const mutations: { name: string; disabled: boolean }[] = [];
  let queryCount = 0;
  const values = options.rosterValues ?? [false];
  const client: CustomAgentsToggleClient = {
    query: async () => {
      const index = Math.min(queryCount, values.length - 1);
      queryCount += 1;
      const row = {
        role: 'alpha',
        source: 'custom',
        disabled: values[index],
        disableable: true,
      } satisfies RosterEntry;
      const roster =
        options.roster !== undefined ? options.roster : options.omitRosterRow === true ? [] : [row];
      return {
        roster,
        sources: [
          {
            scope: 'workspace',
            workingDir: '/repo',
            agentCount: 1,
            issues: options.issues ?? [],
          },
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

  it('reports an over-limit agent instead of timing out when enabling it', async () => {
    // Agents past the per-chatroom cap never reach the roster, so waiting for a
    // row would always time out even though the change was applied.
    const fake = createClient({
      rosterValues: [false],
      omitRosterRow: true,
      issues: [{ path: 'alpha', reason: 'over-limit' }],
    });
    const harness = createDeps(fake.client);

    await setCustomAgentDisabled('chatroom-1', 'alpha', false, harness.deps);

    expect(fake.mutations).toEqual([{ name: 'alpha', disabled: false }]);
    expect(harness.lines).toEqual([
      'enabled, but it is over the custom-agent limit of 16 and is not used until another agent is disabled',
    ]);
    expect(harness.exitCodes).toEqual([]);
    expect(fake.queries()).toBe(1);
  });

  it('reports an agent displaced by the cap alongside the confirmed enable', async () => {
    // The real merge keeps the agent just enabled and cuts `agent-9`, whose enable
    // is still stored. Silence there would leave the agent gone without a word.
    const names = [...AT_CAP, 'agent-17'];
    const after = mergedRoster(names, []);
    expect(after.issues).toContainEqual({ path: 'agent-9', reason: 'over-limit' });

    const fake = createClient({ roster: after.roster, issues: after.issues });
    const harness = createDeps(fake.client);

    await setCustomAgentDisabled('chatroom-1', 'agent-17', false, harness.deps);

    expect(fake.mutations).toEqual([{ name: 'agent-17', disabled: false }]);
    expect(harness.lines).toEqual([
      'confirmed',
      'not in use: agent-9 — the chatroom already runs 16 custom agents. It joins when another one is turned off.',
    ]);
    expect(harness.exitCodes).toEqual([]);
  });

  it('does not report a displaced agent for a disable', async () => {
    // Turning an agent off frees a slot, so nothing can be pushed out.
    const fake = createClient({
      roster: [{ role: 'agent-17', source: 'custom', disabled: true, disableable: true }],
      issues: [{ path: 'zeta', reason: 'over-limit' }],
    });
    const harness = createDeps(fake.client);

    await setCustomAgentDisabled('chatroom-1', 'agent-17', true, harness.deps);

    expect(harness.lines).toEqual(['confirmed']);
  });

  it('does not treat a detail that merely mentions the agent as over-limit', async () => {
    // Only an issue whose `path` is the agent names it. An over-limit issue for
    // `reviewer` must not make enabling `rev` report over-limit: the detail text
    // is free prose and is not a match key.
    const fake = createClient({
      rosterValues: [false],
      omitRosterRow: true,
      issues: [{ path: 'reviewer', reason: 'over-limit', detail: 'agent rev over the cap' }],
    });
    const harness = createDeps(fake.client);

    await setCustomAgentDisabled('chatroom-1', 'rev', false, harness.deps);

    expect(fake.mutations).toEqual([{ name: 'rev', disabled: false }]);
    expect(harness.lines).toEqual([
      'timed out waiting for the daemon; the change is still pending',
    ]);
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
