/**
 * register-agent Unit Tests
 *
 * Tests the register-agent command using injected dependencies.
 * Covers: auth validation, successful registration (custom and remote),
 * registration failure (mutation throws error).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RegisterAgentDeps } from './deps.js';
import { registerAgent, type RegisterAgentOptions } from './index.js';

// ---------------------------------------------------------------------------
// Mock modules (for non-injectable side effects)
// ---------------------------------------------------------------------------

vi.mock('../../infrastructure/machine/index.js', () => ({
  ensureMachineRegistered: vi.fn().mockReturnValue({
    machineId: 'machine_123',
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['agent-harness-1'],
    harnessVersions: { 'agent-harness-1': '1.0.0' },
  }),
}));

vi.mock('../../infrastructure/services/remote-agents/opencode/index.js', () => ({
  OpenCodeAgentService: class MockOpenCodeAgentService {
    listModels = vi.fn().mockResolvedValue([]);
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_SESSION_ID = 'test-session-id';

function createMockDeps(overrides?: Partial<RegisterAgentDeps>): RegisterAgentDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ _id: TEST_CHATROOM_ID }),
    },
    session: {
      getSessionId: vi.fn().mockReturnValue(TEST_SESSION_ID),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockReturnValue([]),
    },
    ...overrides,
  };
}

function defaultOptions(overrides?: Partial<RegisterAgentOptions>): RegisterAgentOptions {
  return {
    role: 'planner',
    type: 'custom',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let exitSpy: any;

let logSpy: any;

let errorSpy: any;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getAllLogOutput(): string {
  return logSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

function getAllErrorOutput(): string {
  return errorSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerAgent', () => {
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue([]),
        },
      });

      await registerAgent(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Not authenticated');
    });

    it('shows other session URLs when available', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue(['http://other:3210']),
        },
      });

      await registerAgent(TEST_CHATROOM_ID, defaultOptions(), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('http://other:3210');
    });
  });

  describe('successful registration', () => {
    it('calls saveTeamAgentConfig mutation and logs success (custom)', async () => {
      const deps = createMockDeps();

      await registerAgent(TEST_CHATROOM_ID, defaultOptions({ type: 'custom' }), deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(deps.backend.mutation).toHaveBeenCalledTimes(1);

      const output = getAllLogOutput();
      expect(output).toContain('Registered as custom agent');
      expect(output).toContain('planner');
    });

    it('calls machines.register mutation only and logs success (remote)', async () => {
      // register-agent for remote type calls machines.register AND
      // machines.recordAgentRegistered (to emit agent.registered event).
      // saveTeamAgentConfig is intentionally NOT called — start-agent (the UI
      // "Start Agent" button) exclusively owns the team agent config for remote agents.
      const deps = createMockDeps();

      await registerAgent(TEST_CHATROOM_ID, defaultOptions({ type: 'remote' }), deps);

      expect(exitSpy).not.toHaveBeenCalled();
      // Two mutations: machines.register + machines.recordAgentRegistered
      expect(deps.backend.mutation).toHaveBeenCalledTimes(2);

      const output = getAllLogOutput();
      expect(output).toContain('Registered as remote agent');
      expect(output).toContain('planner');
      expect(output).toContain('test-host');
    });
  });

  describe('saveTeamAgentConfig not called for remote type', () => {
    it('does NOT call saveTeamAgentConfig for remote type', async () => {
      // register-agent must NOT call saveTeamAgentConfig for remote agents.
      // start-agent (the UI "Start Agent" button) exclusively owns the team
      // agent config. Any call here would write incomplete/premature config
      // (missing harness, model) before the user configures the agent via the UI.
      // However, it DOES call recordAgentRegistered to emit the event.
      const deps = createMockDeps();

      await registerAgent(TEST_CHATROOM_ID, defaultOptions({ type: 'remote' }), deps);

      expect(exitSpy).not.toHaveBeenCalled();

      // Two mutation calls: machines.register + machines.recordAgentRegistered
      const mutationCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
      expect(mutationCalls).toHaveLength(2);

      // Neither call should be saveTeamAgentConfig
      for (const [endpoint] of mutationCalls as Array<[{ _name?: string } | string, unknown]>) {
        const endpointStr = typeof endpoint === 'string' ? endpoint : JSON.stringify(endpoint);
        expect(endpointStr).not.toContain('saveTeamAgentConfig');
      }
    });
  });

  describe('registration failure', () => {
    it('exits with code 1 when saveTeamAgentConfig mutation throws (custom)', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Permission denied')
      );

      await registerAgent(TEST_CHATROOM_ID, defaultOptions({ type: 'custom' }), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);

      const errOutput = getAllErrorOutput();
      expect(errOutput).toContain('Registration failed');
      expect(errOutput).toContain('Permission denied');
    });

    it('exits with code 1 when machines.register mutation throws (remote)', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Register failed')
      );

      await registerAgent(TEST_CHATROOM_ID, defaultOptions({ type: 'remote' }), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);

      const errOutput = getAllErrorOutput();
      expect(errOutput).toContain('Registration failed');
      expect(errOutput).toContain('Register failed');
    });
  });
});
