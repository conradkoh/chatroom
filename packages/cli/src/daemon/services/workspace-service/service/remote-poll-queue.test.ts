import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRemotePollQueue } from './remote-poll-queue.js';

const MIN_GAP_MS = 10_000;

/** A promise the test settles by hand, so a run can be held in flight for as long as needed. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeQueue(run: (workingDir: string) => Promise<void>, minGapMs = MIN_GAP_MS) {
  return createRemotePollQueue({ minGapMs, now: () => Date.now(), run });
}

/** Advances fake time and flushes the promise chain between timers. */
function advance(ms: number): Promise<void> {
  return vi.advanceTimersByTimeAsync(ms).then(() => undefined);
}

describe('createRemotePollQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('never runs two workspaces at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const queue = makeQueue(async (workingDir) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const gate = deferred();
      gates.set(workingDir, gate);
      await gate.promise;
      inFlight--;
    });

    queue.schedule('/a', 0);
    queue.schedule('/b', 0);
    await advance(0);
    expect([...gates.keys()]).toEqual(['/a']);

    gates.get('/a')?.resolve();
    await advance(0);
    expect([...gates.keys()]).toEqual(['/a', '/b']);

    gates.get('/b')?.resolve();
    await queue.stopAll();
    expect(maxInFlight).toBe(1);
  });

  it('enforces the min gap per workspace, not across workspaces', async () => {
    const starts: [string, number][] = [];
    const queue = makeQueue(async (workingDir) => {
      starts.push([workingDir, Date.now()]);
    });

    queue.schedule('/a', 0);
    await advance(1_000);
    queue.schedule('/b', 0);
    queue.schedule('/a', 0);
    await advance(MIN_GAP_MS);

    expect(starts).toEqual([
      ['/a', 0],
      ['/b', 1_000],
      ['/a', 10_000],
    ]);
    await queue.stopAll();
  });

  it('replaces the pending timer when a workspace is rescheduled', async () => {
    const run = vi.fn(async (_workingDir: string) => {});
    const queue = makeQueue(run);

    queue.schedule('/a', 5_000);
    queue.schedule('/a', 1_000);
    await advance(1_000);
    expect(run).toHaveBeenCalledTimes(1);

    await advance(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    await queue.stopAll();
  });

  it('cancel prevents the pending run', async () => {
    const run = vi.fn(async (_workingDir: string) => {});
    const queue = makeQueue(run);

    queue.schedule('/a', 1_000);
    queue.cancel('/a');
    await advance(5_000);

    expect(run).not.toHaveBeenCalled();
    await queue.stopAll();
  });

  it('stopAll clears timers and makes later schedule calls no-ops', async () => {
    const run = vi.fn(async (_workingDir: string) => {});
    const queue = makeQueue(run);

    queue.schedule('/a', 1_000);
    await queue.stopAll();
    queue.schedule('/b', 0);
    await advance(5_000);

    expect(run).not.toHaveBeenCalled();
  });

  it('stopAll drops runs that have not started yet', async () => {
    const gate = deferred();
    const run = vi.fn(async (workingDir: string) => {
      if (workingDir === '/a') await gate.promise;
    });
    const queue = makeQueue(run);

    queue.schedule('/a', 0);
    queue.schedule('/b', 0);
    await advance(0);
    const stopping = queue.stopAll();
    gate.resolve();
    await stopping;

    expect(run.mock.calls.map(([workingDir]) => workingDir)).toEqual(['/a']);
  });

  it('keeps the chain running after a run rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = vi.fn(async (workingDir: string) => {
      if (workingDir === '/a') throw new Error('gh failed');
    });
    const queue = makeQueue(run);

    queue.schedule('/a', 0);
    queue.schedule('/b', 0);
    await advance(0);

    expect(run.mock.calls.map(([workingDir]) => workingDir)).toEqual(['/a', '/b']);
    expect(consoleError).toHaveBeenCalledTimes(1);
    await queue.stopAll();
  });

  it('stopAll resolves only after the in-flight run settles', async () => {
    const gate = deferred();
    const queue = makeQueue(() => gate.promise);

    queue.schedule('/a', 0);
    await advance(0);
    let settled = false;
    const stopping = queue.stopAll().then(() => {
      settled = true;
    });

    await advance(0);
    expect(settled).toBe(false);

    gate.resolve();
    await stopping;
    expect(settled).toBe(true);
  });
});
