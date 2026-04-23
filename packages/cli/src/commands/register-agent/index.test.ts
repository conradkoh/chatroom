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
  getMachineId: vi.fn().mockReturnValue('machine_123'),
  loadMachineConfig: vi.fn().mockReturnValue({
    machineId: 'machine_123',
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
    harnessVersions: {},
    registeredAt: '2024-01-01T00:00:00.000Z',
    lastSyncedAt: '2024-01-01T00:00:00.000Z',
  }),
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
    it('calls recordCustomAgentRegistered mutation and logs success (custom)', async () => {
      const deps = createMockDeps();

      await registerAgent(TEST_CHATROOM_ID, defaultOptions({ type: 'custom' }), deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(deps.backend.mutation).toHaveBeenCalledTimes(1);

      const output = getAllLogOutput();
      expect(output).toContain('Registered as custom agent');
      expect(output).toContain('planner');
    });

    it('calls recordRemoteAgentRegistered and logs success (remote)', async () => {
      // register-agent for remote type calls only machines.recordRemoteAgentRegistered.
      // Machine registration is owned by the daemon (`machine start`).
      // saveTeamAgentConfig is intentionally NOT called — start-agent (the UI
      // "Start Agent" button) exclusively owns the team agent config for remote agents.
      const deps = createMockDeps();

      await registerAgent(TEST_CHATROOM_ID, defaultOptions({ type: 'remote' }), deps);

      expect(exitSpy).not.toHaveBeenCalled();
      // One mutation: machines.recordRemoteAgentRegistered (no machines.register)
      expect(deps.backend.mutation).toHaveBeenCalledTimes(1);

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
      // agent config. Only recordRemoteAgentRegistered is called.
      const deps = createMockDeps();

      await registerAgent(TEST_CHATROOM_ID, defaultOptions({ type: 'remote' }), deps);

      expect(exitSpy).not.toHaveBeenCalled();

      // One mutation call: machines.recordRemoteAgentRegistered
      const mutationCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
      expect(mutationCalls).toHaveLength(1);

      // The call should not be saveTeamAgentConfig
      for (const [endpoint] of mutationCalls as [{ _name?: string } | string, unknown][]) {
        const endpointStr = typeof endpoint === 'string' ? endpoint : JSON.stringify(endpoint);
        expect(endpointStr).not.toContain('saveTeamAgentConfig');
      }
    });
  });

  describe('machine not registered (remote)', () => {
    it('exits with code 1 when machine is not registered', async () => {
      const { getMachineId } = await import('../../infrastructure/machine/index.js');
      (getMachineId as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      const deps = createMockDeps();

      await registerAgent(TEST_CHATROOM_ID, defaultOptions({ type: 'remote' }), deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Machine not registered');
      expect(getAllErrorOutput()).toContain('chatroom machine start');
    });
  });

  describe('registration failure', () => {
    it('exits with code 1 when recordCustomAgentRegistered mutation throws (custom)', async () => {
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

    it('succeeds even when recordRemoteAgentRegistered fails for remote (non-critical)', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Event write failed')
      );

      await registerAgent(TEST_CHATROOM_ID, defaultOptions({ type: 'remote' }), deps);

      // Should not exit — recordRemoteAgentRegistered failure is non-critical
      expect(exitSpy).not.toHaveBeenCalled();
      const output = getAllLogOutput();
      expect(output).toContain('Registered as remote agent');
    });
  });

  describe('agent.registered event emission (remote)', () => {
    it('calls recordRemoteAgentRegistered with correct args', async () => {
      const deps = createMockDeps();

      await registerAgent(TEST_CHATROOM_ID, defaultOptions({ type: 'remote' }), deps);

      expect(exitSpy).not.toHaveBeenCalled();

      // Only one mutation call: recordRemoteAgentRegistered
      const mutationCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
      expect(mutationCalls).toHaveLength(1);

      const [, callArgs] = mutationCalls[0] as [unknown, Record<string, unknown>];
      expect(callArgs).toMatchObject({
        sessionId: TEST_SESSION_ID,
        chatroomId: TEST_CHATROOM_ID,
        role: 'planner',
        machineId: 'machine_123',
      });
    });

    it('succeeds even when recordRemoteAgentRegistered mutation fails (non-critical)', async () => {
      const deps = createMockDeps();
      const mutationMock = deps.backend.mutation as ReturnType<typeof vi.fn>;
      mutationMock.mockRejectedValueOnce(new Error('Event stream write failed'));

      await registerAgent(TEST_CHATROOM_ID, defaultOptions({ type: 'remote' }), deps);

      expect(exitSpy).not.toHaveBeenCalled();
      const output = getAllLogOutput();
      expect(output).toContain('Registered as remote agent');
    });
  });
});
