import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../api.js', () => {
  const api: Record<string, unknown> = {};
  const setPath = (obj: Record<string, unknown>, path: string[], value: string) => {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]]) current[path[i]] = {};
      current = current[path[i]] as Record<string, unknown>;
    }
    current[path[path.length - 1]] = value;
  };
  setPath(api, ['web', 'enhancer', 'index', 'getJob'], 'getJob');
  return { api };
});

import { waitForEnhancerJobResolution } from './wait-for-enhancer-job.js';

describe('waitForEnhancerJobResolution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves complete via poll', async () => {
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'complete' });

    const backend = { query: getJob };
    const onFailure = vi.fn();
    const onExitCb: (() => void)[] = [];

    const promise = waitForEnhancerJobResolution({
      sessionId: 'session',
      chatroomId: 'room1',
      jobId: 'job1',
      backend: backend as any,
      onFailure,
      onExit: (cb) => {
        onExitCb.push(cb);
      },
    });

    // Advance well past poll interval to get second poll result
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10);

    const result = await promise;
    expect(result).toBe('complete');
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('agent_end without complete calls forceTerminal failure', async () => {
    const getJob = vi.fn().mockResolvedValue({ status: 'running' });
    const backend = { query: getJob };
    const onFailure = vi.fn();
    const onAgentEndCb: (() => void)[] = [];

    const promise = waitForEnhancerJobResolution({
      sessionId: 'session',
      chatroomId: 'room1',
      jobId: 'job1',
      backend: backend as any,
      onFailure,
      onAgentEnd: (cb) => {
        onAgentEndCb.push(cb);
      },
      onExit: vi.fn(),
    });

    // Fire agent_end
    onAgentEndCb[0]();

    // Advance past grace period
    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result).toBe('failed');
    expect(onFailure).toHaveBeenCalledWith('Agent exited without completing enhancer job', true);
  });

  it('silence timeout triggers failure', async () => {
    const getJob = vi.fn().mockResolvedValue({ status: 'running' });
    const backend = { query: getJob };
    const onFailure = vi.fn();

    const promise = waitForEnhancerJobResolution({
      sessionId: 'session',
      chatroomId: 'room1',
      jobId: 'job1',
      backend: backend as any,
      onFailure,
      onExit: vi.fn(),
    });

    // Advance past silence timeout (120s)
    await vi.advanceTimersByTimeAsync(121_000);
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result).toBe('failed');
    expect(onFailure).toHaveBeenCalledWith('Enhancer silence timeout — no output received', false);
  });

  it('onExit without complete triggers failure', async () => {
    const getJob = vi.fn().mockResolvedValue({ status: 'running' });
    const backend = { query: getJob };
    const onFailure = vi.fn();
    const onExitCb: (() => void)[] = [];

    const promise = waitForEnhancerJobResolution({
      sessionId: 'session',
      chatroomId: 'room1',
      jobId: 'job1',
      backend: backend as any,
      onFailure,
      onExit: (cb) => {
        onExitCb.push(cb);
      },
    });

    // Fire onExit
    onExitCb[0]();

    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result).toBe('failed');
    expect(onFailure).toHaveBeenCalledWith(
      'Agent process exited without completing enhancer job',
      false
    );
  });
});
