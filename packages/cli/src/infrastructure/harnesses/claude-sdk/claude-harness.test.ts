import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ClaudeSdkHarness, startClaudeSdkHarness } from './index.js';

const mockQuery = vi.fn();

vi.mock('../../services/remote-agents/claude-sdk/claude-sdk-package.js', () => ({
  importBundledClaudeSdk: vi.fn(async () => ({
    query: (...args: unknown[]) => mockQuery(...args),
  })),
  resolvePathToClaudeCodeExecutable: vi.fn(async () => '/tmp/claude'),
  formatClaudeSdkLoadError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

function stubQuery(messages: unknown[]) {
  const queryInstance = {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) {
        yield message;
      }
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
  };
  mockQuery.mockReturnValue(queryInstance);
  return queryInstance;
}

describe('ClaudeSdkHarness', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('lists a single primary builder agent', async () => {
    const harness = new ClaudeSdkHarness('/tmp/work', { query: mockQuery } as never, '/tmp/claude');
    const agents = await harness.listAgents();
    expect(agents).toEqual([{ name: 'builder', mode: 'primary' }]);
  });

  it('newSession creates session with UUID opencodeSessionId', async () => {
    const harness = new ClaudeSdkHarness('/tmp/work', { query: mockQuery } as never, '/tmp/claude');
    const session = await harness.newSession({});

    expect(session.opencodeSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    await harness.close();
  });

  it('prompt emits deltas and session.idle', async () => {
    stubQuery([
      { type: 'system', subtype: 'init', session_id: 'provider-1' },
      {
        type: 'stream_event',
        session_id: 'provider-1',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'hello' },
        },
      },
      { type: 'result', subtype: 'success', session_id: 'provider-1', is_error: false },
    ]);

    const harness = new ClaudeSdkHarness('/tmp/work', { query: mockQuery } as never, '/tmp/claude');
    const session = await harness.newSession({});
    const events: { type: string; payload?: unknown }[] = [];

    session.onEvent((event) => {
      events.push({ type: event.type, payload: event.payload });
    });

    await session.prompt({
      agent: 'builder',
      parts: [{ type: 'text', text: 'hi' }],
    });

    expect(events.some((e) => e.type === 'message.part.delta')).toBe(true);
    expect(events.some((e) => e.type === 'session.provider_id')).toBe(true);
    expect(events.at(-1)?.type).toBe('session.idle');
    await harness.close();
  });

  it('startClaudeSdkHarness fails when SDK unavailable', async () => {
    const { importBundledClaudeSdk } =
      await import('../../services/remote-agents/claude-sdk/claude-sdk-package.js');
    vi.mocked(importBundledClaudeSdk).mockRejectedValueOnce(new Error('SDK missing'));

    await expect(
      startClaudeSdkHarness({
        harnessName: 'claude-sdk',
        workingDir: '/tmp',
        workspaceId: 'ws-1',
        resolvedConvexUrl: 'http://test:3210',
      })
    ).rejects.toThrow('claude-sdk unavailable');
  });

  it('resumeSession returns cached in-memory session', async () => {
    const harness = new ClaudeSdkHarness('/tmp/work', { query: mockQuery } as never, '/tmp/claude');
    const resumed = await harness.resumeSession('provider-1' as never);
    const cached = await harness.resumeSession('provider-1' as never);

    expect(cached).toBe(resumed);
    await harness.close();
  });
});
