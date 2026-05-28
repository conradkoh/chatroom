import { EventEmitter } from 'node:events';

import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import {
  CursorSdkAgentService,
  type CursorSdkAgentServiceDeps,
} from './cursor-sdk-agent-service.js';
import { createSpawnPrompt } from '../spawn-prompt.js';

const sharedAgentCreateFn = vi.fn();
const sharedAgentSendFn = vi.fn();
const sharedAgentCloseFn = vi.fn();

vi.mock('@cursor/sdk', () => ({
  Agent: {
    create: (...args: unknown[]) => sharedAgentCreateFn(...args),
  },
  Cursor: {
    models: {
      list: vi.fn(),
    },
  },
}));

function createMockDeps(overrides?: Partial<CursorSdkAgentServiceDeps>): CursorSdkAgentServiceDeps {
  return {
    execSync: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    ...overrides,
  };
}

function makeFakeChild(pid = 4321) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.kill = vi.fn();
  return child;
}

function stubSdkAgent() {
  const run = {
    id: 'run-1',
    stream: async function* () {},
    wait: vi.fn().mockResolvedValue({ id: 'run-1', status: 'finished' }),
    supports: () => false,
    cancel: vi.fn(),
  };

  const agent = {
    agentId: 'agent-1',
    send: sharedAgentSendFn.mockResolvedValue(run),
    close: sharedAgentCloseFn,
  };

  sharedAgentCreateFn.mockResolvedValue(agent);
  return { agent, run };
}

const SPAWN_CONTEXT = { machineId: 'm1', chatroomId: 'c1', role: 'builder' };

describe('CursorSdkAgentService', () => {
  let stderrWriteSpy: MockInstance<typeof process.stderr.write>;
  const originalApiKey = process.env.CURSOR_API_KEY;

  beforeEach(() => {
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    sharedAgentCreateFn.mockReset();
    sharedAgentSendFn.mockReset();
    sharedAgentCloseFn.mockReset();
    process.env.CURSOR_API_KEY = 'cursor_test_key';
  });

  afterEach(() => {
    stderrWriteSpy.mockRestore();
    if (originalApiKey === undefined) {
      delete process.env.CURSOR_API_KEY;
    } else {
      process.env.CURSOR_API_KEY = originalApiKey;
    }
  });

  describe('isInstalled', () => {
    it('returns false when CURSOR_API_KEY is not set', async () => {
      delete process.env.CURSOR_API_KEY;
      const service = new CursorSdkAgentService(createMockDeps());
      expect(await service.isInstalled()).toBe(false);
    });

    it('returns true when CURSOR_API_KEY is set', async () => {
      const service = new CursorSdkAgentService(createMockDeps());
      expect(await service.isInstalled()).toBe(true);
    });
  });

  describe('spawn', () => {
    it('calls Agent.create with apiKey and local cwd', async () => {
      stubSdkAgent();
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CursorSdkAgentService(deps);

      await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
      });

      expect(sharedAgentCreateFn).toHaveBeenCalledWith({
        apiKey: 'cursor_test_key',
        name: 'builder@c1',
        model: { id: 'composer-2.5' },
        local: { cwd: '/tmp/work', settingSources: [] },
      });
    });

    it('calls agent.send with combined system and user prompt', async () => {
      stubSdkAgent();
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CursorSdkAgentService(deps);

      await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
      });

      expect(sharedAgentSendFn).toHaveBeenCalledWith(
        'you are helpful\n\ndo work',
        expect.objectContaining({
          local: { force: true },
          idempotencyKey: expect.any(String),
        })
      );
    });
  });

  describe('stop', () => {
    it('calls agent.close()', async () => {
      stubSdkAgent();
      const child = makeFakeChild(5555);
      const deps = createMockDeps({
        spawn: vi.fn().mockReturnValue(child),
        kill: vi.fn((_pid: number, signal: number | string) => {
          if (signal === 0) throw new Error('process not found');
          return true;
        }),
      });
      const service = new CursorSdkAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'system',
        context: SPAWN_CONTEXT,
      });

      await service.stop(result.pid);

      expect(sharedAgentCloseFn).toHaveBeenCalled();
    });
  });
});
