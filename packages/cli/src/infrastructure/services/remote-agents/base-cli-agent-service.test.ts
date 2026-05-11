import { EventEmitter, Readable } from 'node:stream';

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { BaseCLIAgentService, type CLIAgentServiceDeps } from './base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from './remote-agent-service.js';
import { isInstalled, isNotInstalled, isDetectionError } from './detection-result.js';

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

  async isInstalled(): Promise<boolean> {
    return this.checkInstalled(this.command);
  }

  async getVersion(): Promise<Awaited<ReturnType<typeof this.checkVersion>>> {
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

  public async testCheckInstalledDetailed(command: string) {
    const effect = this.checkInstalledDetailedEffect(command);
    const { Effect } = await import('effect');
    return Effect.runPromise(effect);
  }

  public async testRunListCommand(
    harnessName: string,
    command: string,
    options?: { timeout?: number }
  ) {
    return this.runListCommand(harnessName, command, options);
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
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isInstalled', () => {
    it('returns true when command is found via which/where', async () => {
      const deps = createMockDeps({ execSync: vi.fn() });
      const service = new TestAgentService('myapp', deps);
      expect(await service.isInstalled()).toBe(true);
    });

    it('returns false when execSync throws (command not found)', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          const err = new Error('Command failed: which myapp') as Error & {
            status?: number;
            stderr?: Buffer;
          };
          err.status = 1;
          err.stderr = Buffer.from('');
          throw err;
        }),
      });
      const service = new TestAgentService('myapp', deps);
      expect(await service.isInstalled()).toBe(false);
    });

    it('calls execSync with which on non-windows platforms', async () => {
      const execSync = vi.fn();
      const deps = createMockDeps({ execSync });
      const service = new TestAgentService('mytool', deps);
      await service.isInstalled();
      if (process.platform !== 'win32') {
        expect(execSync).toHaveBeenCalledWith('which mytool', { stdio: ['pipe', 'pipe', 'pipe'] });
      } else {
        expect(execSync).toHaveBeenCalledWith('where mytool', { stdio: ['pipe', 'pipe', 'pipe'] });
      }
    });
  });

  describe('getVersion', () => {
    it('parses semver with v prefix (v1.2.3)', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('v1.2.3')),
      });
      const service = new TestAgentService('mytool', deps);
      expect(await service.getVersion()).toEqual({ version: '1.2.3', major: 1 });
    });

    it('parses semver without v prefix (0.55.0)', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('0.55.0')),
      });
      const service = new TestAgentService('mytool', deps);
      expect(await service.getVersion()).toEqual({ version: '0.55.0', major: 0 });
    });

    it('parses semver embedded in longer output', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('mytool version 2.10.1 (build 1234)')),
      });
      const service = new TestAgentService('mytool', deps);
      expect(await service.getVersion()).toEqual({ version: '2.10.1', major: 2 });
    });

    it('returns null for garbage/unparseable output', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('unknown output')),
      });
      const service = new TestAgentService('mytool', deps);
      expect(await service.getVersion()).toBeNull();
    });

    it('returns null when command throws', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('command not found');
        }),
      });
      const service = new TestAgentService('mytool', deps);
      expect(await service.getVersion()).toBeNull();
    });

    it('calls execSync with correct --version command (including stderr redirect)', async () => {
      const execSync = vi.fn().mockReturnValue(Buffer.from('1.0.0'));
      const deps = createMockDeps({ execSync });
      const service = new TestAgentService('mytool', deps);
      await service.getVersion();
      expect(execSync).toHaveBeenCalledWith(
        'mytool --version 2>&1',
        expect.objectContaining({ timeout: 5000 })
      );
    });

    it('retries transient failures and resolves with parsed version on success', async () => {
      vi.useFakeTimers();
      let callCount = 0;
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            throw new Error('transient failure');
          }
          return Buffer.from('v1.2.3');
        }),
      });
      const service = new TestAgentService('mytool', deps);
      const promise = service.getVersion();
      await vi.advanceTimersByTimeAsync(100);
      expect(await promise).toEqual({ version: '1.2.3', major: 1 });
      expect(deps.execSync).toHaveBeenCalledTimes(2);
    });

    it('returns null after exhausted retries (does not throw)', async () => {
      vi.useFakeTimers();
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('persistent transient');
        }),
      });
      const service = new TestAgentService('mytool', deps);
      const promise = service.getVersion();
      await vi.advanceTimersByTimeAsync(1000);
      await expect(promise).resolves.toBeNull();
      expect(deps.execSync).toHaveBeenCalledTimes(3);
    });

    it('delays retries exponentially (50ms, 100ms) capped at 500ms', async () => {
      vi.useFakeTimers();
      const startTime = Date.now();
      const callTimes: number[] = [];
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          callTimes.push(Date.now() - startTime);
          throw new Error('persistent transient');
        }),
      });
      const service = new TestAgentService('mytool', deps);
      const promise = service.getVersion();

      await vi.advanceTimersByTimeAsync(1000);
      await expect(promise).resolves.toBeNull();

      expect(deps.execSync).toHaveBeenCalledTimes(3);
      expect(callTimes[0]).toBe(0);
      expect(callTimes[1]).toBeGreaterThanOrEqual(45);
      expect(callTimes[1]).toBeLessThanOrEqual(60);
      expect(callTimes[2]).toBeGreaterThanOrEqual(95);
      expect(callTimes[2]).toBeLessThanOrEqual(160);
    });
  });

  describe('runListCommand', () => {
    it('returns trimmed output on success', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('model/a\nmodel/b\n')),
      });
      const service = new TestAgentService('mytool', deps);

      await expect(service.testRunListCommand('mytool', 'mytool models')).resolves.toBe(
        'model/a\nmodel/b'
      );
      expect(deps.execSync).toHaveBeenCalledWith(
        'mytool models',
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 })
      );
    });

    it('warns and returns null after exhausted retries', async () => {
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('persistent transient');
        }),
      });
      const service = new TestAgentService('mytool', deps);
      const promise = service.testRunListCommand('mytool', 'mytool models');

      await vi.advanceTimersByTimeAsync(1000);
      await expect(promise).resolves.toBeNull();
      expect(deps.execSync).toHaveBeenCalledTimes(3);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toEqual({
        event: 'list-models-error',
        harness: 'mytool',
        reason: 'persistent transient',
        attempts: 3,
      });

      warnSpy.mockRestore();
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

  describe('detectInstallation', () => {
    it('returns Installed when execSync succeeds', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('/usr/bin/mytool')),
      });
      const service = new TestAgentService('mytool', deps);
      const result = await service.detectInstallation();
      expect(isInstalled(result)).toBe(true);
      expect(deps.execSync).toHaveBeenCalledTimes(1);
    });

    it('returns NotInstalled when execSync exits with status 1 and empty stderr', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          const err = new Error('Command failed: which mytool') as Error & {
            status?: number;
            stderr?: Buffer;
          };
          err.status = 1;
          err.stderr = Buffer.from('');
          throw err;
        }),
      });
      const service = new TestAgentService('mytool', deps);
      const result = await service.detectInstallation();
      expect(isNotInstalled(result)).toBe(true);
      expect(deps.execSync).toHaveBeenCalledTimes(1); // No retry
    });

    it('returns DetectionError when execSync fails with non-1 status (retried then exhausted)', async () => {
      vi.useFakeTimers();
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          const err = new Error('Command failed: which mytool') as Error & {
            status?: number;
            stderr?: Buffer;
          };
          err.status = 127;
          err.stderr = Buffer.from('some error');
          throw err;
        }),
      });
      const service = new TestAgentService('mytool', deps);
      const promise = service.detectInstallation();
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;
      expect(isDetectionError(result)).toBe(true);
      if (isDetectionError(result)) {
        expect(result.reason).toContain('Command failed');
        expect(result.attempts).toBe(3);
      }
      expect(deps.execSync).toHaveBeenCalledTimes(3); // Retried 3 times
      vi.useRealTimers();
    });

    it('returns Installed when transient error then success', async () => {
      vi.useFakeTimers();
      let callCount = 0;
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            const err = new Error('Transient error') as Error & {
              status?: number;
              stderr?: Buffer;
            };
            err.status = 127;
            err.stderr = Buffer.from('error');
            throw err;
          }
          return Buffer.from('/usr/bin/mytool');
        }),
      });
      const service = new TestAgentService('mytool', deps);
      const promise = service.detectInstallation();
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;
      expect(isInstalled(result)).toBe(true);
      expect(deps.execSync).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('returns NotInstalled when transient error then terminal not-installed', async () => {
      vi.useFakeTimers();
      let callCount = 0;
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            const err = new Error('Transient error') as Error & {
              status?: number;
              stderr?: Buffer;
            };
            err.status = 127;
            err.stderr = Buffer.from('error');
            throw err;
          }
          const err = new Error('Command failed: which mytool') as Error & {
            status?: number;
            stderr?: Buffer;
          };
          err.status = 1;
          err.stderr = Buffer.from('');
          throw err;
        }),
      });
      const service = new TestAgentService('mytool', deps);
      const promise = service.detectInstallation();
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;
      expect(isNotInstalled(result)).toBe(true);
      expect(deps.execSync).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('returns DetectionError when non-Error is thrown', async () => {
      vi.useFakeTimers();
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw 'string error'; // eslint-disable-line no-throw-literal
        }),
      });
      const service = new TestAgentService('mytool', deps);
      const promise = service.detectInstallation();
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;
      expect(isDetectionError(result)).toBe(true);
      if (isDetectionError(result)) {
        expect(result.attempts).toBe(3);
      }
      vi.useRealTimers();
    });

    it('resolves (not rejects) when retries are exhausted', async () => {
      vi.useFakeTimers();
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('persistent transient');
        }),
      });
      const service = new TestAgentService('mytool', deps);
      const promise = service.detectInstallation();
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;
      expect(isDetectionError(result)).toBe(true);
      vi.useRealTimers();
    });

    it('isInstalled() returns false for both NotInstalled and DetectionError', async () => {
      // NotInstalled
      const depsNotInstalled = createMockDeps({
        execSync: vi.fn(() => {
          const err = new Error('not found') as Error & { status?: number; stderr?: Buffer };
          err.status = 1;
          err.stderr = Buffer.from('');
          throw err;
        }),
      });
      const svc1 = new TestAgentService('mytool', depsNotInstalled);
      expect(await svc1.isInstalled()).toBe(false);

      // DetectionError
      vi.useFakeTimers();
      const depsDetectionError = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('some error');
        }),
      });
      const svc2 = new TestAgentService('mytool', depsDetectionError);
      const p2 = svc2.isInstalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(await p2).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('detectInstallation exponential backoff', () => {
    it('delays retries exponentially (50ms, 100ms) capped at 500ms', async () => {
      vi.useFakeTimers();
      const startTime = Date.now();
      const callTimes: number[] = [];
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          callTimes.push(Date.now() - startTime);
          const err = new Error('transient') as Error & { status?: number; stderr?: Buffer };
          err.status = 127;
          err.stderr = Buffer.from('error');
          throw err;
        }),
      });
      const service = new TestAgentService('mytool', deps);
      const promise = service.detectInstallation();

      // Advance past all retry delays
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(isDetectionError(result)).toBe(true);
      expect(deps.execSync).toHaveBeenCalledTimes(3);

      // First call is immediate, then 50ms delay, then 100ms delay
      expect(callTimes[0]).toBe(0);
      expect(callTimes[1]).toBeGreaterThanOrEqual(45);
      expect(callTimes[1]).toBeLessThanOrEqual(60);
      expect(callTimes[2]).toBeGreaterThanOrEqual(95);
      expect(callTimes[2]).toBeLessThanOrEqual(160); // 50 + 100 + some tolerance

      vi.useRealTimers();
    });
  });

  describe('detectInstallation concurrency', () => {
    it('handles 10 parallel detections without shared-state contamination', async () => {
      // Create 10 services with different outcomes
      const services = Array.from({ length: 10 }, (_, i) => {
        const deps = createMockDeps({
          execSync: vi.fn(() => {
            if (i < 5) {
              // Installed
              return Buffer.from('/usr/bin/mytool');
            } else if (i < 8) {
              // NotInstalled
              const err = new Error('not found') as Error & { status?: number; stderr?: Buffer };
              err.status = 1;
              err.stderr = Buffer.from('');
              throw err;
            } else {
              // DetectionError
              const err = new Error('transient') as Error & { status?: number; stderr?: Buffer };
              err.status = 127;
              err.stderr = Buffer.from('error');
              throw err;
            }
          }),
        });
        return new TestAgentService(`tool-${i}`, deps);
      });

      // Run all detections in parallel
      const results = await Promise.all(services.map((svc) => svc.detectInstallation()));

      // Verify each result
      for (let i = 0; i < 10; i++) {
        const result = results[i];
        if (i < 5) {
          expect(isInstalled(result)).toBe(true);
        } else if (i < 8) {
          expect(isNotInstalled(result)).toBe(true);
        } else {
          expect(isDetectionError(result)).toBe(true);
          if (isDetectionError(result)) {
            expect(result.attempts).toBe(3);
          }
        }
      }
    });
  });
});
