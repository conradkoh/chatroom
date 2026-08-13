import { describe, expect, it, vi } from 'vitest';

import { processEnhancerJob } from './process-enhancer-job.js';
import type { EnhancerQueueJob } from '../../ports/enhancer-queue.port.js';

function makeJob(): EnhancerQueueJob {
  return {
    jobId: 'local:room-1:msg-1',
    chatroomId: 'room-1',
    machineId: 'machine-1',
    status: 'claimed',
    payload: {
      agentHarness: 'opencode',
      model: 'gpt-4',
      machineId: 'machine-1',
      content: 'Review this handoff.',
      workingDir: '/tmp/work',
    },
    createdAt: 100,
    updatedAt: 100,
  };
}

describe('processEnhancerJob', () => {
  it('spawns the enhancer and marks the job complete on agent_end', async () => {
    const agentEndCallback: (() => void)[] = [];
    const spawn = vi.fn().mockReturnValue({
      pid: 123,
      onLogLine: vi.fn(),
      onAgentEnd: (cb: () => void) => agentEndCallback.push(cb),
      onExit: vi.fn(),
    });
    const stop = vi.fn().mockResolvedValue(undefined);
    const agentServices = new Map([['opencode', { spawn, stop }]]) as any;
    const queue = {
      markComplete: vi.fn(),
      markFailed: vi.fn(),
    };

    const promise = processEnhancerJob(
      {
        sessionId: 'session-1',
        machineId: 'machine-1',
        convexUrl: 'http://convex',
        backend: { query: vi.fn().mockResolvedValue([]), mutation: vi.fn() },
        agentServices,
      },
      makeJob(),
      queue as any
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDir: '/tmp/work',
        model: 'gpt-4',
        resolvedConvexUrl: 'http://convex',
      })
    );

    agentEndCallback[0]!();
    await promise;

    expect(queue.markComplete).toHaveBeenCalledWith('local:room-1:msg-1');
    expect(queue.markFailed).not.toHaveBeenCalled();
  });

  it('marks the job failed when the harness is unavailable', async () => {
    const agentServices = new Map<string, unknown>();
    const queue = { markComplete: vi.fn(), markFailed: vi.fn() };

    await processEnhancerJob(
      {
        sessionId: 'session-1',
        machineId: 'machine-1',
        convexUrl: 'http://convex',
        backend: { query: vi.fn(), mutation: vi.fn() },
        agentServices: agentServices as any,
      },
      makeJob(),
      queue as any
    );

    expect(queue.markFailed).toHaveBeenCalledWith('local:room-1:msg-1');
    expect(queue.markComplete).not.toHaveBeenCalled();
  });
});
