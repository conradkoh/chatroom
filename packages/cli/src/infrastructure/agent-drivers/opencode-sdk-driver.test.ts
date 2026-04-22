/**
 * OpenCodeSdkDriver tests
 *
 * Tests the SDK driver using mocked SDK dependencies.
 */

import { describe, expect, it, vi } from 'vitest';

import { OpenCodeSdkDriver } from './opencode-sdk-driver.js';
import type { OpenCodeSdkDriverDeps } from './opencode-sdk-driver.js';
import type { AgentHandle } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeServer(url = 'http://localhost:4444') {
  return {
    url,
    close: vi.fn(),
  };
}

function makeSession(id = 'sess-1') {
  return {
    id,
    projectID: 'proj-1',
    directory: '/tmp/work',
    title: 'Test session',
    version: '1.0.0',
  };
}

type MockClient = {
  session: {
    create: ReturnType<typeof vi.fn>;
    promptAsync: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
  };
  provider: {
    list: ReturnType<typeof vi.fn>;
  };
};

function makeClient(): MockClient {
  return {
    session: {
      create: vi.fn().mockResolvedValue({ data: makeSession() }),
      promptAsync: vi.fn().mockResolvedValue({ data: null }),
      abort: vi.fn().mockResolvedValue({ data: null }),
      get: vi.fn().mockResolvedValue({ data: makeSession() }),
      status: vi.fn().mockResolvedValue({ data: { 'sess-1': { type: 'idle' } } }),
    },
    provider: {
      list: vi.fn().mockResolvedValue({
        data: {
          all: [
            {
              id: 'anthropic',
              name: 'Anthropic',
              env: [],
              models: {
                'claude-3-5-sonnet': { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' },
              },
            },
          ],
        },
      }),
    },
  };
}

function makeDeps(): OpenCodeSdkDriverDeps & { client: MockClient } {
  const client = makeClient();
  const server = makeServer();
  return {
    client,
    createServer: vi.fn().mockResolvedValue(server),
    createClient: vi.fn().mockReturnValue(client),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OpenCodeSdkDriver', () => {
  describe('harness and capabilities', () => {
    it('has harness=opencode-sdk', () => {
      const driver = new OpenCodeSdkDriver();
      expect(driver.harness).toBe('opencode-sdk');
    });

    it('declares sessionPersistence, abort, modelSelection, compaction, dynamicModelDiscovery', () => {
      const driver = new OpenCodeSdkDriver();
      expect(driver.capabilities.sessionPersistence).toBe(true);
      expect(driver.capabilities.abort).toBe(true);
      expect(driver.capabilities.modelSelection).toBe(true);
      expect(driver.capabilities.compaction).toBe(true);
      expect(driver.capabilities.dynamicModelDiscovery).toBe(true);
      // Not yet wired in this PR
      expect(driver.capabilities.eventStreaming).toBe(false);
      expect(driver.capabilities.messageInjection).toBe(false);
    });
  });

  describe('start()', () => {
    it('returns a session handle with sessionId, serverUrl, workingDir', async () => {
      const deps = makeDeps();
      const driver = new OpenCodeSdkDriver(deps);

      const handle = await driver.start({
        workingDir: '/tmp/work',
        rolePrompt: 'You are a helpful assistant.',
        initialMessage: 'Hello!',
      });

      expect(handle.type).toBe('session');
      expect(handle.harness).toBe('opencode-sdk');
      expect(handle.sessionId).toBe('sess-1');
      expect(handle.serverUrl).toBe('http://localhost:4444');
      expect(handle.workingDir).toBe('/tmp/work');
    });

    it('sends combined rolePrompt + initialMessage as first prompt', async () => {
      const deps = makeDeps();
      const driver = new OpenCodeSdkDriver(deps);

      await driver.start({
        workingDir: '/tmp/work',
        rolePrompt: 'System role.',
        initialMessage: 'First message.',
      });

      expect(deps.client.session.promptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'sess-1' },
          body: expect.objectContaining({
            parts: [{ type: 'text', text: 'System role.\n\nFirst message.' }],
          }),
        })
      );
    });

    it('passes model in provider/model format when provided', async () => {
      const deps = makeDeps();
      const driver = new OpenCodeSdkDriver(deps);

      await driver.start({
        workingDir: '/tmp/work',
        rolePrompt: '',
        initialMessage: 'Hello',
        model: 'anthropic/claude-3-5-sonnet',
      });

      expect(deps.client.session.promptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' },
          }),
        })
      );
    });
  });

  describe('stop()', () => {
    it('calls session.abort with the session id', async () => {
      const deps = makeDeps();
      const driver = new OpenCodeSdkDriver(deps);

      const handle: AgentHandle = {
        harness: 'opencode-sdk',
        type: 'session',
        sessionId: 'sess-1',
        serverUrl: 'http://localhost:4444',
        workingDir: '/tmp/work',
      };

      await driver.stop(handle);

      expect(deps.client.session.abort).toHaveBeenCalledWith({ path: { id: 'sess-1' } });
    });

    it('does not throw if server is unreachable', async () => {
      const deps = makeDeps();
      deps.client.session.abort.mockRejectedValue(new Error('ECONNREFUSED'));
      const driver = new OpenCodeSdkDriver(deps);

      const handle: AgentHandle = {
        harness: 'opencode-sdk',
        type: 'session',
        sessionId: 'sess-1',
        serverUrl: 'http://localhost:4444',
        workingDir: '/tmp/work',
      };

      await expect(driver.stop(handle)).resolves.toBeUndefined();
    });
  });

  describe('isAlive()', () => {
    it('returns true when handle has sessionId and serverUrl', () => {
      const driver = new OpenCodeSdkDriver();
      const handle: AgentHandle = {
        harness: 'opencode-sdk',
        type: 'session',
        sessionId: 'sess-1',
        serverUrl: 'http://localhost:4444',
        workingDir: '/tmp/work',
      };
      expect(driver.isAlive(handle)).toBe(true);
    });

    it('returns false when handle is missing sessionId', () => {
      const driver = new OpenCodeSdkDriver();
      const handle: AgentHandle = {
        harness: 'opencode-sdk',
        type: 'session',
        serverUrl: 'http://localhost:4444',
        workingDir: '/tmp/work',
      };
      expect(driver.isAlive(handle)).toBe(false);
    });
  });

  describe('listModels()', () => {
    it('returns provider/model strings from provider.list()', async () => {
      const deps = makeDeps();
      const driver = new OpenCodeSdkDriver(deps);

      const models = await driver.listModels();

      expect(models).toContain('anthropic/claude-3-5-sonnet');
    });

    it('returns [] if server creation fails', async () => {
      const deps = makeDeps();
      deps.createServer = vi.fn().mockRejectedValue(new Error('Cannot start'));
      const driver = new OpenCodeSdkDriver(deps);

      const models = await driver.listModels();

      expect(models).toEqual([]);
    });
  });
});

describe('AgentDriverRegistry — opencode-sdk smoke test', () => {
  it('resolves opencode-sdk to the SDK driver', async () => {
    const { createDefaultDriverRegistry } = await import('./registry.js');
    const { OpenCodeSdkDriver } = await import('./opencode-sdk-driver.js');

    const registry = createDefaultDriverRegistry();
    const driver = registry.get('opencode-sdk');
    expect(driver).toBeInstanceOf(OpenCodeSdkDriver);
    expect(driver.harness).toBe('opencode-sdk');
  });

  it('resolves opencode to the process driver (unchanged)', async () => {
    const { createDefaultDriverRegistry } = await import('./registry.js');
    const { OpenCodeProcessDriver } = await import('./opencode-process-driver.js');

    const registry = createDefaultDriverRegistry();
    const driver = registry.get('opencode');
    expect(driver).toBeInstanceOf(OpenCodeProcessDriver);
  });
});
