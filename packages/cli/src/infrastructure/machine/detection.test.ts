import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Effect, Duration } from 'effect';

import { detectAvailableHarnesses } from './detection.js';
import {
  BaseCLIAgentService,
  type CLIAgentServiceDeps,
} from '../services/remote-agents/base-cli-agent-service.js';
import {
  DetectionResult,
  isInstalled,
  isDetectionError,
} from '../services/remote-agents/detection-result.js';
import type {
  SpawnOptions,
  SpawnResult,
  RemoteAgentService,
} from '../services/remote-agents/remote-agent-service.js';

// ─── Mock Harness Registry ────────────────────────────────────────────────────

vi.mock('../services/remote-agents/index.js', () => ({
  initHarnessRegistry: vi.fn(),
  getAllHarnesses: vi.fn(() => []),
  getHarness: vi.fn(),
}));

// ─── Test Helpers ─────────────────────────────────────────────────────────────

class FakeInstalledService extends BaseCLIAgentService {
  readonly id = 'installed';
  readonly displayName = 'Installed';
  readonly command = 'installed-cmd';

  async isInstalled() {
    return true;
  }
  async getVersion() {
    return null;
  }
  async listModels(): Promise<string[]> {
    return [];
  }
  async spawn(_options: SpawnOptions): Promise<SpawnResult> {
    return { pid: 0, onExit: () => {}, onOutput: () => {} };
  }
}

class FakeNotInstalledService extends BaseCLIAgentService {
  readonly id = 'not-installed';
  readonly displayName = 'Not Installed';
  readonly command = 'not-installed-cmd';

  async isInstalled() {
    return false;
  }
  async getVersion() {
    return null;
  }
  async listModels(): Promise<string[]> {
    return [];
  }
  async spawn(_options: SpawnOptions): Promise<SpawnResult> {
    return { pid: 0, onExit: () => {}, onOutput: () => {} };
  }
}

class FakeDetectionErrorService extends BaseCLIAgentService {
  readonly id = 'broken';
  readonly displayName = 'Broken';
  readonly command = 'broken-cmd';

  async isInstalled() {
    return false;
  }
  async getVersion() {
    return null;
  }
  async listModels(): Promise<string[]> {
    return [];
  }
  async spawn(_options: SpawnOptions): Promise<SpawnResult> {
    return { pid: 0, onExit: () => {}, onOutput: () => {} };
  }
}

class DelayedFakeService extends BaseCLIAgentService {
  readonly id: string;
  readonly displayName = 'Delayed';
  readonly command = 'delayed-cmd';
  private readonly delayMs: number;
  private readonly outcome: 'installed' | 'not-installed' | 'error';

  constructor(id: string, delayMs: number, outcome: 'installed' | 'not-installed' | 'error') {
    super();
    this.id = id;
    this.delayMs = delayMs;
    this.outcome = outcome;
  }

  override detectInstallationEffect() {
    return Effect.delay(
      Effect.succeed(
        this.outcome === 'installed'
          ? DetectionResult.Installed()
          : this.outcome === 'not-installed'
            ? DetectionResult.NotInstalled()
            : DetectionResult.DetectionError('delayed error', 1)
      ),
      Duration.millis(this.delayMs)
    );
  }

  async isInstalled() {
    return this.outcome === 'installed';
  }
  async getVersion() {
    return null;
  }
  async listModels(): Promise<string[]> {
    return [];
  }
  async spawn(_options: SpawnOptions): Promise<SpawnResult> {
    return { pid: 0, onExit: () => {}, onOutput: () => {} };
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('detectAvailableHarnesses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns only installed harnesses', async () => {
    const { getAllHarnesses } = await import('../services/remote-agents/index.js');
    const mockedGetAll = vi.mocked(getAllHarnesses);

    const installedService = new FakeInstalledService(createMockDeps());
    const notInstalledService = new FakeNotInstalledService(
      createMockDeps({
        execSync: vi.fn(() => {
          const err = new Error('not found') as Error & { status?: number; stderr?: Buffer };
          err.status = 1;
          err.stderr = Buffer.from('');
          throw err;
        }),
      })
    );

    mockedGetAll.mockReturnValue([
      installedService,
      notInstalledService,
    ] as unknown as RemoteAgentService[]);

    const result = await detectAvailableHarnesses();
    expect(result).toEqual(['installed']);
  });

  it('emits structured console.warn for detection errors', async () => {
    const { getAllHarnesses } = await import('../services/remote-agents/index.js');
    const mockedGetAll = vi.mocked(getAllHarnesses);

    const brokenService = new FakeDetectionErrorService(
      createMockDeps({
        execSync: vi.fn(() => {
          const err = new Error('some error') as Error & { status?: number; stderr?: Buffer };
          err.status = 127;
          err.stderr = Buffer.from('error');
          throw err;
        }),
      })
    );

    mockedGetAll.mockReturnValue([brokenService] as unknown as RemoteAgentService[]);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await detectAvailableHarnesses();

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const payload = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(payload).toMatchObject({
      event: 'harness-detection-error',
      harness: 'broken',
      attempts: expect.any(Number),
      reason: expect.any(String),
    });

    warnSpy.mockRestore();
  });

  it('does not warn for NotInstalled harnesses', async () => {
    const { getAllHarnesses } = await import('../services/remote-agents/index.js');
    const mockedGetAll = vi.mocked(getAllHarnesses);

    const notInstalledService = new FakeNotInstalledService(
      createMockDeps({
        execSync: vi.fn(() => {
          const err = new Error('not found') as Error & { status?: number; stderr?: Buffer };
          err.status = 1;
          err.stderr = Buffer.from('');
          throw err;
        }),
      })
    );

    mockedGetAll.mockReturnValue([notInstalledService] as unknown as RemoteAgentService[]);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await detectAvailableHarnesses();

    expect(result).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('falls back to boolean isInstalled() for non-BaseCLIAgentService instances', async () => {
    const { getAllHarnesses } = await import('../services/remote-agents/index.js');
    const mockedGetAll = vi.mocked(getAllHarnesses);

    const fakeService: RemoteAgentService = {
      id: 'fake',
      displayName: 'Fake',
      command: 'fake-cmd',
      isInstalled: async () => true,
      getVersion: async () => null,
      listModels: async () => [],
      spawn: async () => ({ pid: 0, onExit: () => {}, onOutput: () => {} }),
      stop: async () => {},
      isAlive: () => false,
      getTrackedProcesses: () => [],
      untrack: () => {},
    };

    mockedGetAll.mockReturnValue([fakeService]);

    const result = await detectAvailableHarnesses();
    expect(result).toEqual(['fake']);
  });

  it('runs detection in parallel (~max delay, not sum)', async () => {
    vi.useFakeTimers();
    const { getAllHarnesses } = await import('../services/remote-agents/index.js');
    const mockedGetAll = vi.mocked(getAllHarnesses);

    const startTime = Date.now();

    // Three services with delays 30ms, 60ms, 90ms
    const svc30 = new DelayedFakeService('delay-30', 30, 'installed');
    const svc60 = new DelayedFakeService('delay-60', 60, 'installed');
    const svc90 = new DelayedFakeService('delay-90', 90, 'installed');

    mockedGetAll.mockReturnValue([svc30, svc60, svc90] as unknown as RemoteAgentService[]);

    const promise = detectAvailableHarnesses();
    // Advance past the longest delay
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    const elapsed = Date.now() - startTime;

    // Parallel: should complete in ~90ms (max delay), not 180ms (sum)
    expect(elapsed).toBeGreaterThanOrEqual(85);
    expect(elapsed).toBeLessThanOrEqual(120);
    expect(result).toContain('delay-30');
    expect(result).toContain('delay-60');
    expect(result).toContain('delay-90');
  });

  it('handles mixed outcomes in parallel', async () => {
    vi.useFakeTimers();
    const { getAllHarnesses } = await import('../services/remote-agents/index.js');
    const mockedGetAll = vi.mocked(getAllHarnesses);

    const svcInstalled = new DelayedFakeService('ok', 20, 'installed');
    const svcNotInstalled = new DelayedFakeService('missing', 30, 'not-installed');
    const svcError = new DelayedFakeService('broken', 40, 'error');

    mockedGetAll.mockReturnValue([
      svcInstalled,
      svcNotInstalled,
      svcError,
    ] as unknown as RemoteAgentService[]);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const promise = detectAvailableHarnesses();
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toEqual(['ok']);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(payload).toMatchObject({
      event: 'harness-detection-error',
      harness: 'broken',
    });

    warnSpy.mockRestore();
  });
});
