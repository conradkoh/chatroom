import { describe, it, expect, vi, afterEach } from 'vitest';

import { ensureLocation } from './ensure-location.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type IdList = { data: { id: string }[] };

/**
 * Build a fake client. `agentList` and `providerList` are called once per probe,
 * so each takes the probe index and returns that probe's result.
 */
function makeClient(opts: {
  agentList?: (probe: number) => Promise<IdList>;
  providerList?: (probe: number) => Promise<IdList>;
  locationGet?: () => Promise<unknown>;
}) {
  let probe = 0;
  const agentList = vi.fn(() => {
    const result = opts.agentList?.(probe) ?? Promise.resolve({ data: [{ id: 'build' }] });
    return result;
  });
  const providerList = vi.fn(() => {
    const result = opts.providerList?.(probe) ?? Promise.resolve({ data: [{ id: 'openai' }] });
    probe++;
    return result;
  });
  const locationGet = vi.fn(opts.locationGet ?? (() => Promise.resolve({})));
  const client = {
    location: { get: locationGet },
    agent: { list: agentList },
    provider: { list: providerList },
  };
  return { client: client as never, agentList, providerList, locationGet };
}

/** Result sequence indexed by probe number, repeating the last entry. */
function sequence(results: IdList[]): (probe: number) => Promise<IdList> {
  return (probe) => Promise.resolve(results[Math.min(probe, results.length - 1)] as IdList);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ensureLocation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls location.get with the directory', async () => {
    const { client, locationGet } = makeClient({});

    await ensureLocation(client, '/work/repo');

    expect(locationGet).toHaveBeenCalledWith({ location: { directory: '/work/repo' } });
  });

  it('waits past a mid-load change until the catalogue is stable for ~1s', async () => {
    vi.useFakeTimers();
    // Agents grow from 1 to 2 on the third probe, then stay put.
    const { client, agentList } = makeClient({
      agentList: sequence([
        { data: [{ id: 'build' }] },
        { data: [{ id: 'build' }] },
        { data: [{ id: 'build' }, { id: 'planner' }] },
      ]),
    });

    const done = ensureLocation(client, '/work/repo');
    let settled = false;
    void done.then(() => (settled = true));

    // The early matching reads (150ms apart) must not end the wait.
    await vi.advanceTimersByTimeAsync(300);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    await done;

    // Probes: t=0 (A), t=150 (A), t=300 (A+planner, changed), then stable for 1s.
    expect(agentList.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(agentList).toHaveBeenCalledWith({ location: { directory: '/work/repo' } });
  });

  it('treats the same ids in a different order as unchanged', async () => {
    vi.useFakeTimers();
    const { client, agentList } = makeClient({
      agentList: sequence([
        { data: [{ id: 'build' }, { id: 'plan' }] },
        { data: [{ id: 'plan' }, { id: 'build' }] },
      ]),
    });

    const done = ensureLocation(client, '/work/repo');
    await vi.advanceTimersByTimeAsync(1_500);
    await done;

    // Stable from the second read, so it returns after the 1s window: about 8 probes at 150ms.
    expect(agentList.mock.calls.length).toBeLessThanOrEqual(9);
  });

  it('also waits for provider.list to settle (providers can lag agents)', async () => {
    vi.useFakeTimers();
    const { client, providerList } = makeClient({
      agentList: sequence([{ data: [{ id: 'build' }] }]),
      providerList: sequence([{ data: [] }, { data: [] }, { data: [{ id: 'openai' }] }]),
    });

    const done = ensureLocation(client, '/work/repo');
    let settled = false;
    void done.then(() => (settled = true));

    // Agents are stable from the start, but the provider change at probe 2 must extend the wait.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    expect(providerList).toHaveBeenCalledWith({ location: { directory: '/work/repo' } });
  });

  it('stops at the ~3s cap when the catalogue never settles', async () => {
    vi.useFakeTimers();
    const { client, agentList } = makeClient({
      agentList: (probe) => Promise.resolve({ data: [{ id: `agent-${probe}` }] }),
    });

    const done = ensureLocation(client, '/work/repo');
    let settled = false;
    void done.then(() => (settled = true));

    await vi.advanceTimersByTimeAsync(2_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    // Returned by the 3s cap even though the catalogue never settled.
    expect(settled).toBe(true);
    await done;

    // Bounded: roughly one probe every 150ms within the 3s budget.
    expect(agentList.mock.calls.length).toBeGreaterThan(2);
    expect(agentList.mock.calls.length).toBeLessThanOrEqual(25);
  });

  it('returns at the cap when a probe hangs instead of blocking startup', async () => {
    vi.useFakeTimers();
    const { client, agentList } = makeClient({
      agentList: () => new Promise<IdList>(() => {}),
    });

    const done = ensureLocation(client, '/work/repo');
    await vi.advanceTimersByTimeAsync(3_100);
    await done;

    expect(agentList).toHaveBeenCalledTimes(1);
  });

  it('returns at the cap when location.get hangs instead of blocking startup', async () => {
    vi.useFakeTimers();
    const { client, agentList } = makeClient({
      locationGet: () => new Promise<unknown>(() => {}),
    });

    const done = ensureLocation(client, '/work/repo');
    await vi.advanceTimersByTimeAsync(3_100);
    await done;

    // The cap was spent inside location.get, so no readiness probes run.
    expect(agentList).not.toHaveBeenCalled();
  });

  it('is best-effort: swallows probe errors and ends polling immediately', async () => {
    const { client, agentList } = makeClient({
      agentList: () => Promise.reject(new Error('boom')),
      locationGet: () => Promise.reject(new Error('no location resource')),
    });

    await expect(ensureLocation(client, '/work/repo')).resolves.toBeUndefined();
    expect(agentList).toHaveBeenCalledTimes(1);
  });

  it('still polls when location.get fails', async () => {
    vi.useFakeTimers();
    const { client, agentList } = makeClient({
      locationGet: () => Promise.reject(new Error('location.get unavailable')),
    });

    const done = ensureLocation(client, '/work/repo');
    await vi.advanceTimersByTimeAsync(1_500);
    await done;

    expect(agentList.mock.calls.length).toBeGreaterThan(1);
  });
});
