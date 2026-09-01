import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { CursorSdkHarness, startCursorSdkHarness } from './index.js';

const mockAgentCreate = vi.fn();
const mockAgentResume = vi.fn();
const mockFetchCatalog = vi.fn();

vi.mock('@cursor/sdk', () => ({
  Agent: {
    create: (...args: unknown[]) => mockAgentCreate(...args),
    resume: (...args: unknown[]) => mockAgentResume(...args),
  },
  Cursor: {
    models: {
      list: vi.fn(),
    },
  },
}));

vi.mock('../../services/cursor-sdk/cursor-sdk-package.js', () => ({
  importBundledCursorSdk: vi.fn(async () => import('@cursor/sdk')),
  formatCursorSdkLoadError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock('../../services/cursor-sdk/cursor-sdk-model-catalog.js', () => ({
  fetchCursorSdkModelCatalog: (...args: unknown[]) => mockFetchCatalog(...args),
  cursorCatalogBaseId: (id: string) => (id === 'default' ? 'auto' : id),
  cursorSdkBaseId: (id: string) => (id === 'auto' ? 'default' : id),
  expandCursorSdkModelCatalog: vi.fn(),
}));

function stubAgent(agentId = 'agent-1') {
  const run = {
    stream: async function* () {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      };
    },
    wait: vi.fn().mockResolvedValue({ id: 'run-1', status: 'finished' }),
  };
  const agent = {
    agentId,
    send: vi.fn().mockResolvedValue(run),
    close: vi.fn(),
  };
  mockAgentCreate.mockResolvedValue(agent);
  mockAgentResume.mockResolvedValue(agent);
  return agent;
}

describe('CursorSdkHarness', () => {
  const originalApiKey = process.env.CURSOR_API_KEY;

  beforeEach(() => {
    process.env.CURSOR_API_KEY = 'test-key';
    mockAgentCreate.mockReset();
    mockAgentResume.mockReset();
    mockFetchCatalog.mockReset();
    mockFetchCatalog.mockResolvedValue(['auto', 'gpt-5.6-terra', 'gpt-5.6-terra[effort=high]']);
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = originalApiKey;
  });

  it('lists a single primary builder agent', async () => {
    const harness = new CursorSdkHarness('/tmp/work');
    const agents = await harness.listAgents();
    expect(agents).toEqual([{ name: 'builder', mode: 'primary' }]);
  });

  it('listProviders returns SDK catalog', async () => {
    const harness = new CursorSdkHarness('/tmp/work');
    const providers = await harness.listProviders();
    expect(mockFetchCatalog).toHaveBeenCalled();
    expect(providers[0].models.map((model) => model.modelID)).toEqual([
      'auto',
      'gpt-5.6-terra',
      'gpt-5.6-terra[effort=high]',
    ]);
  });

  it('creates a session via Agent.create', async () => {
    stubAgent();
    const harness = new CursorSdkHarness('/tmp/work');
    const session = await harness.newSession({ model: 'cursor/composer-2.5' });

    expect(mockAgentCreate).toHaveBeenCalled();
    expect(session.opencodeSessionId).toBe('agent-1');
    await harness.close();
  });

  it('startCursorSdkHarness requires CURSOR_API_KEY', async () => {
    delete process.env.CURSOR_API_KEY;
    await expect(
      startCursorSdkHarness({
        harnessName: 'cursor-sdk',
        workingDir: '/tmp',
        workspaceId: 'ws-1',
        resolvedConvexUrl: 'http://test:3210',
      })
    ).rejects.toThrow('CURSOR_API_KEY');
  });
});
