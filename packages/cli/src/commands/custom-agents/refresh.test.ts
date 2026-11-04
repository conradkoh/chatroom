import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { refreshCustomAgents, type CustomAgentsRefreshClient } from './refresh.js';

function createDeps(options: { mutationError?: unknown } = {}) {
  const lines: string[] = [];
  const exitCodes: number[] = [];
  const calls: { endpoint: unknown; args: unknown }[] = [];
  const client: CustomAgentsRefreshClient = {
    mutation: async (endpoint, args) => {
      calls.push({ endpoint, args });
      if (options.mutationError !== undefined) throw options.mutationError;
      return { queued: true };
    },
  };
  return {
    lines,
    exitCodes,
    calls,
    deps: {
      client,
      sessionId: 'session-1',
      stdout: (line: string) => lines.push(line),
      setExitCode: (code: number) => exitCodes.push(code),
    },
  };
}

describe('refreshCustomAgents', () => {
  it('requests one refresh and prints the acknowledgement', async () => {
    const harness = createDeps();

    await refreshCustomAgents('chatroom-1', harness.deps);

    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]?.args).toEqual({ sessionId: 'session-1', chatroomId: 'chatroom-1' });
    expect(harness.lines).toEqual(['refresh requested']);
    expect(harness.exitCodes).toEqual([]);
  });

  it('prints the backend error and exits 1 when the request fails', async () => {
    const harness = createDeps({
      mutationError: new ConvexError({
        code: 'CUSTOM_AGENT_NO_WORKSPACE',
        message: 'Chatroom has no active workspace',
      }),
    });

    await refreshCustomAgents('chatroom-1', harness.deps);

    expect(harness.lines).toEqual(['Chatroom has no active workspace']);
    expect(harness.exitCodes).toEqual([1]);
  });
});
