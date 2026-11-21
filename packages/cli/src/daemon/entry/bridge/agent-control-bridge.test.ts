import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStartAgentDeps } from './agent-control-bridge.js';
import { startAgent, type StartAgentInput } from '../../domain/usecase/start-agent.js';

const input: StartAgentInput = {
  commandId: 'cmd-1',
  chatroomId: 'room-1',
  role: 'builder',
  agentHarness: 'opencode-sdk',
  model: 'model-1',
  workingDir: '/workspace',
  reason: 'user.start',
  deadline: Date.now() + 60_000,
  wantResume: false,
};

function setup(options: { enqueue?: (fact: unknown) => Promise<unknown> } = {}) {
  const enqueue = vi.fn(options.enqueue ?? (async (_fact: unknown) => undefined));
  const session = {
    sessionId: 'session-1',
    machineId: 'machine-1',
    config: null,
    logEvent: vi.fn(async () => {}),
    lifecycleOutbox: { enqueue },
  } as never;
  const processManagerService = {
    startAgent: vi.fn(async () => {
      throw new Error('boom');
    }),
  } as never;
  return { enqueue, session, processManagerService };
}

describe('createStartAgentDeps start failure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueues exactly one error status fact when the process manager rejects the start', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { enqueue, session, processManagerService } = setup();
    await startAgent(createStartAgentDeps(session, processManagerService), input);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith({
      kind: 'status',
      chatroomId: 'room-1',
      role: 'builder',
      status: 'error',
      errorSource: 'configuration',
      errorCode: 'agent.startFailed',
      errorMessage: 'boom',
      revisionKey: expect.any(String),
      emittedAt: expect.any(Number),
    });
    const fact = enqueue.mock.calls[0]?.[0] as { emittedAt: number; revisionKey: string };
    expect(Number.isFinite(fact.emittedAt)).toBe(true);
    expect(fact.revisionKey.length).toBeGreaterThan(0);
  });

  it('does not throw when the lifecycle outbox rejects the failure fact', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { enqueue, session, processManagerService } = setup({
      enqueue: async () => {
        throw new Error('outbox unavailable');
      },
    });
    await expect(
      startAgent(createStartAgentDeps(session, processManagerService), input)
    ).resolves.toBeUndefined();
    expect(enqueue).toHaveBeenCalledOnce();
  });
});
