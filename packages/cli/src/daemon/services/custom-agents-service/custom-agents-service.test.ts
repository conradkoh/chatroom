/**
 * Service behaviour: sources, coalescing, serial pushes, dedup, disable stamping,
 * retries, membership changes, and shutdown. Every dependency is injected, so the
 * suite never touches the filesystem or the network except where a test uses a
 * real store in a temp directory.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FunctionArgs } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createCustomAgentsService,
  type CustomAgentsRefreshReason,
  type CustomAgentsService,
  type CustomAgentsServiceDeps,
} from './custom-agents-service.js';
import { createFileDisabledStateStore } from './disabled-state-store.js';
import type { api } from '../../../api.js';
import type {
  LoadCustomAgentSourceInput,
  LoadedCustomAgentSource,
} from '../../../infrastructure/services/custom-agents/index.js';

type SyncArgs = FunctionArgs<typeof api.customAgents.syncDefinitions>;
type PushResult = { applied: boolean; rejected: { name: string; reason: string }[] };
type Agent = LoadedCustomAgentSource['agents'][number];

function agent(name: string): Agent {
  return {
    name,
    description: `${name} role.`,
    systemPrompt: `You are ${name}.`,
    contentHash: `${name}-hash`,
  };
}

function sourceKey(input: LoadCustomAgentSourceInput): string {
  return input.workspaceRoot ?? 'machine';
}

/** Counts scheduled timers and reports the handles that are still outstanding. */
function createTimerTracker() {
  const scheduled = new Set<unknown>();
  const fired = new Set<unknown>();
  const cleared = new Set<unknown>();
  return {
    setTimer(fn: () => void, ms: number): unknown {
      const handle = setTimeout(() => {
        fired.add(handle);
        fn();
      }, ms);
      scheduled.add(handle);
      return handle;
    },
    clearTimer(handle: unknown): void {
      cleared.add(handle);
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    outstanding(): unknown[] {
      return [...scheduled].filter((handle) => !fired.has(handle) && !cleared.has(handle));
    },
    clearTimerCalls(): number {
      return cleared.size;
    },
  };
}

function createMemoryStore(initial: readonly string[] = []) {
  let names = new Set(initial);
  const writes: string[][] = [];
  return {
    writes,
    store: {
      read: async () => new Set(names),
      write: async (next: ReadonlySet<string>) => {
        names = new Set(next);
        writes.push([...next].sort());
      },
    },
    current: () => new Set(names),
  };
}

interface Harness {
  service: CustomAgentsService;
  pushes: SyncArgs[];
  pushTimes: number[];
  loads: LoadCustomAgentSourceInput[];
  logs: string[];
  timers: ReturnType<typeof createTimerTracker>;
  store: ReturnType<typeof createMemoryStore>;
  emit: (dirs: readonly string[]) => void;
  setAgents: (key: string, agents: Agent[]) => void;
  setPush: (impl: (args: SyncArgs, call: number) => Promise<PushResult>) => void;
  setLoad: (impl: (input: LoadCustomAgentSourceInput) => Promise<LoadedCustomAgentSource>) => void;
  statePath?: string;
}

function createHarness(
  options: {
    agents?: Record<string, Agent[]>;
    state?: CustomAgentsServiceDeps['state'];
    store?: ReturnType<typeof createMemoryStore>;
  } = {}
): Harness {
  const timers = createTimerTracker();
  const memory = options.store ?? createMemoryStore();
  const agents = new Map<string, Agent[]>(
    Object.entries(options.agents ?? { machine: [agent('alpha')] })
  );
  const pushes: SyncArgs[] = [];
  const pushTimes: number[] = [];
  const loads: LoadCustomAgentSourceInput[] = [];
  const logs: string[] = [];
  let handler: ((dirs: readonly string[]) => void) | null = null;
  let pushImpl: (args: SyncArgs, call: number) => Promise<PushResult> = async () => ({
    applied: true,
    rejected: [],
  });
  let loadImpl: ((input: LoadCustomAgentSourceInput) => Promise<LoadedCustomAgentSource>) | null =
    null;

  const deps: CustomAgentsServiceDeps = {
    membership: {
      subscribe: (fn) => {
        handler = fn;
        return () => {
          handler = null;
        };
      },
    },
    machineId: 'machine-1',
    sessionId: 'session-1',
    homeDir: '/home/test',
    load: async (input) => {
      loads.push(input);
      if (loadImpl !== null) return await loadImpl(input);
      return { scope: input.scope, agents: agents.get(sourceKey(input)) ?? [], issues: [] };
    },
    push: async (args) => {
      pushes.push(args);
      pushTimes.push(Date.now());
      return await pushImpl(args, pushes.length);
    },
    state: options.state ?? memory.store,
    now: () => Date.now(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    log: (message) => logs.push(message),
  };

  return {
    service: createCustomAgentsService(deps),
    pushes,
    pushTimes,
    loads,
    logs,
    timers,
    store: memory,
    emit: (dirs) => handler?.(dirs),
    setAgents: (key, next) => agents.set(key, next),
    setPush: (impl) => {
      pushImpl = impl;
    },
    setLoad: (impl) => {
      loadImpl = impl;
    },
  };
}

/** Let queued promise chains and microtasks settle without advancing time. */
async function flush(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sources and membership', () => {
  it('pushes the machine source and one workspace source per registered directory', async () => {
    const harness = createHarness({
      agents: { machine: [agent('alpha')], '/ws/a': [agent('beta')] },
    });

    harness.service.start();
    harness.emit(['/ws/a']);
    await vi.advanceTimersByTimeAsync(600);

    const byScope = harness.pushes.map((args) =>
      args.scope === 'machine' ? 'machine' : args.workingDir
    );
    expect(byScope.sort()).toEqual(['/ws/a', 'machine']);
    const machinePush = harness.pushes.find((args) => args.scope === 'machine');
    expect(machinePush?.machineId).toBe('machine-1');
    expect(machinePush?.sessionId).toBe('session-1');
    expect(machinePush?.agents.map((entry) => entry.name)).toEqual(['alpha']);
  });

  it('stops pushing a removed workspace and clears its timers', async () => {
    const harness = createHarness({ agents: { machine: [], '/ws/a': [agent('beta')] } });

    harness.service.start();
    harness.emit(['/ws/a']);
    await vi.advanceTimersByTimeAsync(600);
    expect(harness.pushes.filter((args) => args.workingDir === '/ws/a')).toHaveLength(1);

    harness.emit([]);
    harness.service.refresh('watch');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(harness.pushes.filter((args) => args.workingDir === '/ws/a')).toHaveLength(1);
    expect(harness.timers.outstanding()).toEqual([]);
  });

  it('does not push a removed workspace whose load is already in flight', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createHarness({ agents: { machine: [], '/ws/a': [agent('beta')] } });
    harness.setLoad(async (input) => {
      if (input.workspaceRoot === '/ws/a') await gate;
      const loaded = input.workspaceRoot === '/ws/a' ? [agent('beta')] : [];
      return { scope: input.scope, agents: loaded, issues: [] };
    });

    harness.service.start();
    harness.emit(['/ws/a']);
    await vi.advanceTimersByTimeAsync(600);
    const workspaceLoads = () => harness.loads.filter((input) => input.workspaceRoot === '/ws/a');
    const workspacePushes = () => harness.pushes.filter((args) => args.workingDir === '/ws/a');
    expect(workspaceLoads()).toHaveLength(1);
    expect(workspacePushes()).toHaveLength(0);

    // The workspace is removed while its load is still gated: nothing may push.
    harness.emit([]);
    release();
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(workspacePushes()).toHaveLength(0);
  });

  it('does not push a removed workspace whose push is already in flight', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createHarness({ agents: { machine: [], '/ws/a': [agent('beta')] } });
    harness.setPush(async (args) => {
      if (args.scope === 'workspace') await gate;
      return { applied: true, rejected: [] };
    });

    harness.service.start();
    harness.emit(['/ws/a']);
    await vi.advanceTimersByTimeAsync(600);
    const workspacePushes = () => harness.pushes.filter((args) => args.workingDir === '/ws/a');
    expect(workspacePushes()).toHaveLength(1);

    harness.emit([]);
    release();
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(workspacePushes()).toHaveLength(1);
    expect(harness.timers.outstanding()).toEqual([]);
  });
});

describe('scheduling', () => {
  it('coalesces five rapid triggers into one load and one push', async () => {
    const harness = createHarness();
    harness.service.start();
    await vi.advanceTimersByTimeAsync(600);
    harness.loads.length = 0;
    harness.pushes.length = 0;
    harness.setAgents('machine', [agent('beta')]);

    for (let index = 0; index < 5; index++) {
      harness.service.refresh('watch');
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(600);

    expect(harness.loads).toHaveLength(1);
    expect(harness.pushes).toHaveLength(1);
  });

  it('never delays a push past the two-second maximum wait', async () => {
    const harness = createHarness();
    harness.service.start();
    await vi.advanceTimersByTimeAsync(600);
    harness.pushes.length = 0;
    harness.pushTimes.length = 0;
    harness.setAgents('machine', [agent('beta')]);
    const startedAt = Date.now();

    for (let elapsed = 0; elapsed < 2_400; elapsed += 100) {
      harness.service.refresh('watch');
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(harness.pushTimes.length).toBeGreaterThanOrEqual(1);
    expect((harness.pushTimes[0] ?? 0) - startedAt).toBeLessThanOrEqual(2_000);
  });

  it('runs pushes serially so the newer snapshot lands last', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createHarness();
    harness.setPush(async (_args, call) => {
      if (call === 1) await gate;
      return { applied: true, rejected: [] };
    });

    harness.service.start();
    await vi.advanceTimersByTimeAsync(600);
    expect(harness.pushes).toHaveLength(1);

    harness.setAgents('machine', [agent('beta')]);
    harness.service.refresh('watch');
    await vi.advanceTimersByTimeAsync(600);
    expect(harness.pushes).toHaveLength(1);

    release();
    await flush();
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.pushes).toHaveLength(2);
    expect(harness.pushes[1]?.agents.map((entry) => entry.name)).toEqual(['beta']);
  });

  it('skips an unchanged snapshot', async () => {
    const harness = createHarness();
    harness.service.start();
    await vi.advanceTimersByTimeAsync(600);
    harness.service.refresh('watch');
    await vi.advanceTimersByTimeAsync(600);

    expect(harness.pushes).toHaveLength(1);
  });
});

describe('disabled stamping', () => {
  it('stamps the stored names and clears the rest', async () => {
    const store = createMemoryStore(['alpha']);
    const harness = createHarness({
      agents: { machine: [agent('alpha'), agent('beta')] },
      store,
    });

    harness.service.start();
    await vi.advanceTimersByTimeAsync(600);

    const pushed = harness.pushes[0]?.agents ?? [];
    expect(pushed.find((entry) => entry.name === 'alpha')?.disabled).toBe(true);
    expect(pushed.find((entry) => entry.name === 'beta')?.disabled).toBe(false);
  });

  it('persists before re-pushing, and a repeated call re-pushes without error', async () => {
    const harness = createHarness({ agents: { machine: [agent('alpha')] } });
    harness.service.start();
    await vi.advanceTimersByTimeAsync(600);
    harness.pushes.length = 0;

    await harness.service.setDisabled('alpha', true);
    expect(harness.store.writes).toEqual([['alpha']]);
    await vi.advanceTimersByTimeAsync(600);
    expect(harness.pushes).toHaveLength(1);
    expect(harness.pushes[0]?.agents[0]?.disabled).toBe(true);

    await expect(harness.service.setDisabled('alpha', true)).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(600);
    expect(harness.pushes).toHaveLength(2);
    expect(harness.store.writes).toHaveLength(1);
  });

  it('rejects an invalid name before writing anything', async () => {
    const harness = createHarness();

    await expect(harness.service.setDisabled('Bad_Name', true)).rejects.toThrow(
      /Invalid custom agent name/
    );
    expect(harness.store.writes).toEqual([]);
  });
});

describe('failures', () => {
  it('retries with exponential backoff and stops after five attempts', async () => {
    const harness = createHarness();
    harness.setPush(async () => {
      throw new Error('boom');
    });
    harness.service.start();
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(harness.pushes).toHaveLength(5);
    const first = harness.pushTimes[0] ?? 0;
    expect(harness.pushTimes.map((time) => time - first)).toEqual([0, 1_000, 3_000, 7_000, 15_000]);
  });

  it('restarts the attempt count on the next trigger', async () => {
    const harness = createHarness();
    harness.setPush(async () => {
      throw new Error('boom');
    });
    harness.service.start();
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 8_000);
    expect(harness.pushes).toHaveLength(5);

    harness.service.refresh('watch');
    await vi.advanceTimersByTimeAsync(600);
    expect(harness.pushes).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.pushes).toHaveLength(7);
  });

  it('does not retry INVALID_SCOPE until the next membership snapshot', async () => {
    const harness = createHarness();
    harness.setPush(async () => {
      throw Object.assign(new Error('invalid scope'), { data: { code: 'INVALID_SCOPE' } });
    });
    harness.service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.pushes).toHaveLength(1);

    harness.service.refresh('watch');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.pushes).toHaveLength(1);

    harness.emit([]);
    harness.service.refresh('watch');
    await vi.advanceTimersByTimeAsync(600);
    expect(harness.pushes).toHaveLength(2);
  });

  it('logs rejected agents once per change', async () => {
    const harness = createHarness();
    harness.setPush(async () => ({
      applied: false,
      rejected: [{ name: 'alpha', reason: 'reserved-name' }],
    }));
    harness.service.start();
    await vi.advanceTimersByTimeAsync(600);
    harness.service.refresh('watch');
    await vi.advanceTimersByTimeAsync(600);

    expect(harness.logs.filter((line) => line.includes('rejected: alpha'))).toHaveLength(1);
  });
});

describe('shutdown', () => {
  it('leaves no pending timers when stopped during an in-flight push', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createHarness();
    harness.setPush(async () => {
      await gate;
      return { applied: true, rejected: [] };
    });

    harness.service.start();
    await vi.advanceTimersByTimeAsync(600);
    harness.service.refresh('watch');
    await vi.advanceTimersByTimeAsync(600);

    const stopping = harness.service.stopAll();
    release();
    await flush();
    await stopping;

    expect(harness.timers.outstanding()).toEqual([]);
    expect(harness.timers.clearTimerCalls()).toBeGreaterThan(0);
    harness.service.refresh('poll' as CustomAgentsRefreshReason);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.pushes).toHaveLength(1);
  });
});

describe('real state file', () => {
  let dir: string;

  beforeEach(async () => {
    vi.useRealTimers();
    dir = await mkdtemp(join(tmpdir(), 'custom-agents-service-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('prunes stale disabled names so a new disable still persists', async () => {
    const statePath = join(dir, 'custom-agents-disabled.json');
    const store = createFileDisabledStateStore(statePath);
    const stale = Array.from({ length: 256 }, (_, index) => `stale-${index}`);
    await store.write(new Set(stale), new Set(stale));
    const harness = createHarness({
      agents: { machine: [agent('alpha')] },
      state: store,
    });

    harness.service.start();
    await vi.waitFor(() => expect(harness.pushes).toHaveLength(1), { timeout: 3_000 });
    // The name is not defined by any source, so the write drops it instead of
    // refusing at the 256-entry cap.
    await harness.service.setDisabled('alpha', true);

    expect([...(await store.read())].sort()).toEqual(['alpha']);
  });

  it('survives a corrupt disabled-state file', async () => {
    const statePath = join(dir, 'custom-agents-disabled.json');
    await writeFile(statePath, '{not json', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = createHarness({
      agents: { machine: [agent('alpha')] },
      state: createFileDisabledStateStore(statePath),
    });

    harness.service.start();
    await vi.waitFor(() => expect(harness.pushes).toHaveLength(1), { timeout: 3_000 });

    expect(harness.pushes[0]?.agents[0]?.disabled).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
