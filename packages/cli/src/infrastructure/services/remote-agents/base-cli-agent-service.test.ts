import { EventEmitter, Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { BaseCLIAgentService, type CLIAgentServiceDeps } from './base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from './remote-agent-service.js';

// ─── Test Concrete Subclass ────────────────────────────────────────────────────

/**
 * Minimal concrete subclass for testing BaseCLIAgentService.
 * Exposes the protected helpers as public methods for direct testing.
 */
class TestAgentService extends BaseCLIAgentService {
  readonly id = 'test';
  readonly displayName = 'Test';
  readonly command: string;

  constructor(command: string, deps?: Partial<CLIAgentServiceDeps>) {
    super(deps);
    this.command = command;
  }

  isInstalled(): boolean {
    return this.checkInstalled(this.command);
  }

  getVersion() {
    return this.checkVersion(this.command);
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  async spawn(_options: SpawnOptions): Promise<SpawnResult> {
    return {
      pid: 0,
      onExit: () => {},
      onOutput: () => {},
    };
  }

  // Expose protected helpers for testing
  public testRegisterProcess(
    pid: number,
    context: { machineId: string; chatroomId: string; role: string }
  ) {
    return this.registerProcess(pid, context);
  }

  public testDeleteProcess(pid: number) {
    return this.deleteProcess(pid);
  }
}

function createMockDeps(overrides?: Partial<CLIAgentServiceDeps>): CLIAgentServiceDeps {
  return {
    execSync: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    ...overrides,
  };
}

const defaultContext = {
  machineId: 'test-machine',
  chatroomId: 'test-chatroom',
  role: 'test-role',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BaseCLIAgentService', () => {
  describe('isInstalled', () => {
    it('returns true when command is found via which/where', () => {
      const deps = createMockDeps({ execSync: vi.fn() });
      const service = new TestAgentService('myapp', deps);
      expect(service.isInstalled()).toBe(true);
    });

    it('returns false when execSync throws (command not found)', () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('not found');
        }),
      });
      const service = new TestAgentService('myapp', deps);
      expect(service.isInstalled()).toBe(false);
    });

    it('calls execSync with which on non-windows platforms', () => {
      const execSync = vi.fn();
      const deps = createMockDeps({ execSync });
      const service = new TestAgentService('mytool', deps);
      service.isInstalled();
      if (process.platform !== 'win32') {
        expect(execSync).toHaveBeenCalledWith('which mytool', { stdio: 'ignore' });
      } else {
        expect(execSync).toHaveBeenCalledWith('where mytool', { stdio: 'ignore' });
      }
    });
  });

  describe('getVersion', () => {
    it('parses semver with v prefix (v1.2.3)', () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('v1.2.3')),
      });
      const service = new TestAgentService('mytool', deps);
      expect(service.getVersion()).toEqual({ version: '1.2.3', major: 1 });
    });

    it('parses semver without v prefix (0.55.0)', () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('0.55.0')),
      });
      const service = new TestAgentService('mytool', deps);
      expect(service.getVersion()).toEqual({ version: '0.55.0', major: 0 });
    });

    it('parses semver embedded in longer output', () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('mytool version 2.10.1 (build 1234)')),
      });
      const service = new TestAgentService('mytool', deps);
      expect(service.getVersion()).toEqual({ version: '2.10.1', major: 2 });
    });

    it('returns null for garbage/unparseable output', () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('unknown output')),
      });
      const service = new TestAgentService('mytool', deps);
      expect(service.getVersion()).toBeNull();
    });

    it('returns null when command throws', () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('command not found');
        }),
      });
      const service = new TestAgentService('mytool', deps);
      expect(service.getVersion()).toBeNull();
    });

    it('calls execSync with correct --version command', () => {
      const execSync = vi.fn().mockReturnValue(Buffer.from('1.0.0'));
      const deps = createMockDeps({ execSync });
      const service = new TestAgentService('mytool', deps);
      service.getVersion();
      expect(execSync).toHaveBeenCalledWith(
        'mytool --version',
        expect.objectContaining({ timeout: 5000 })
      );
    });
  });

  describe('stop', () => {
    it('sends SIGTERM to process group and returns when process exits on poll', async () => {
      const kill = vi
        .fn()
        .mockImplementationOnce(() => {}) // SIGTERM to -pid succeeds
        .mockImplementationOnce(() => {
          // kill(pid, 0) check — process is gone
          throw new Error('ESRCH');
        });

      const deps = createMockDeps({ kill });
      const service = new TestAgentService('mytool', deps);
      await service.stop(1234);

      expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
      expect(kill).toHaveBeenCalledWith(1234, 0);
    });

    it('returns immediately if SIGTERM throws (process already dead)', async () => {
      const kill = vi.fn().mockImplementationOnce(() => {
        throw new Error('ESRCH');
      });

      const deps = createMockDeps({ kill });
      const service = new TestAgentService('mytool', deps);
      await service.stop(1234);

      expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
      expect(kill).toHaveBeenCalledTimes(1);
    });

    it('escalates to SIGKILL when process does not exit within timeout', async () => {
      // Override the timeout/poll constants would require module mocking;
      // instead we verify SIGKILL is called when kill(pid,0) never throws.
      // We mock with a finite number of "alive" responses then let it SIGKILL.
      let callCount = 0;
      const kill = vi.fn().mockImplementation((pid: number, signal: number | string) => {
        if (signal === 'SIGTERM') return; // first call – succeed
        if (signal === 0) {
          // Always alive — force SIGKILL path by advancing time via fake timers
          return;
        }
        if (signal === 'SIGKILL') return;
      });

      // Use fake timers to avoid waiting 5 seconds in tests
      vi.useFakeTimers();
      const deps = createMockDeps({ kill });
      const service = new TestAgentService('mytool', deps);

      const stopPromise = service.stop(9999);
      // Advance past the KILL_TIMEOUT_MS (5000ms)
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;

      expect(kill).toHaveBeenCalledWith(-9999, 'SIGTERM');
      expect(kill).toHaveBeenCalledWith(-9999, 'SIGKILL');
      vi.useRealTimers();
    });
  });

  describe('isAlive', () => {
    it('returns true when kill(pid, 0) succeeds', () => {
      const kill = vi.fn();
      const deps = createMockDeps({ kill });
      const service = new TestAgentService('mytool', deps);
      expect(service.isAlive(5678)).toBe(true);
      expect(kill).toHaveBeenCalledWith(5678, 0);
    });

    it('returns false when kill(pid, 0) throws', () => {
      const kill = vi.fn(() => {
        throw new Error('ESRCH');
      });
      const deps = createMockDeps({ kill });
      const service = new TestAgentService('mytool', deps);
      expect(service.isAlive(5678)).toBe(false);
    });
  });

  describe('getTrackedProcesses', () => {
    it('returns empty array when no processes are registered', () => {
      const deps = createMockDeps();
      const service = new TestAgentService('mytool', deps);
      expect(service.getTrackedProcesses()).toEqual([]);
    });

    it('returns registered processes with pid, context, and lastOutputAt', () => {
      const deps = createMockDeps();
      const service = new TestAgentService('mytool', deps);

      const before = Date.now();
      service.testRegisterProcess(1001, defaultContext);
      const after = Date.now();

      const processes = service.getTrackedProcesses();
      expect(processes).toHaveLength(1);
      expect(processes[0].pid).toBe(1001);
      expect(processes[0].context).toEqual(defaultContext);
      expect(processes[0].lastOutputAt).toBeGreaterThanOrEqual(before);
      expect(processes[0].lastOutputAt).toBeLessThanOrEqual(after);
    });

    it('returns multiple registered processes', () => {
      const deps = createMockDeps();
      const service = new TestAgentService('mytool', deps);

      service.testRegisterProcess(1001, defaultContext);
      service.testRegisterProcess(1002, { ...defaultContext, role: 'role-2' });

      const processes = service.getTrackedProcesses();
      expect(processes).toHaveLength(2);
      const pids = processes.map((p) => p.pid);
      expect(pids).toContain(1001);
      expect(pids).toContain(1002);
    });
  });

  describe('untrack', () => {
    it('removes a process from the registry', () => {
      const deps = createMockDeps();
      const service = new TestAgentService('mytool', deps);

      service.testRegisterProcess(1001, defaultContext);
      expect(service.getTrackedProcesses()).toHaveLength(1);

      service.untrack(1001);
      expect(service.getTrackedProcesses()).toHaveLength(0);
    });

    it('is a no-op when pid is not tracked', () => {
      const deps = createMockDeps();
      const service = new TestAgentService('mytool', deps);
      // Should not throw
      expect(() => service.untrack(9999)).not.toThrow();
    });
  });

  describe('process registry (registerProcess / deleteProcess)', () => {
    it('registerProcess adds to registry and returns entry reference', () => {
      const deps = createMockDeps();
      const service = new TestAgentService('mytool', deps);

      const entry = service.testRegisterProcess(42, defaultContext);
      expect(service.getTrackedProcesses()).toHaveLength(1);
      expect(entry.context).toEqual(defaultContext);
    });

    it('returned entry ref is mutable (lastOutputAt can be updated by spawner)', () => {
      const deps = createMockDeps();
      const service = new TestAgentService('mytool', deps);

      const entry = service.testRegisterProcess(42, defaultContext);
      const originalTime = entry.lastOutputAt;

      // Simulate output arriving
      entry.lastOutputAt = originalTime + 1000;

      const processes = service.getTrackedProcesses();
      expect(processes[0].lastOutputAt).toBe(originalTime + 1000);
    });

    it('deleteProcess removes from registry', () => {
      const deps = createMockDeps();
      const service = new TestAgentService('mytool', deps);

      service.testRegisterProcess(42, defaultContext);
      expect(service.getTrackedProcesses()).toHaveLength(1);

      service.testDeleteProcess(42);
      expect(service.getTrackedProcesses()).toHaveLength(0);
    });
  });
});
