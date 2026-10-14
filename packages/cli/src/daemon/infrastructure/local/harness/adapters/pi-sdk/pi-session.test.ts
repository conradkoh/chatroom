import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import { PiSdkSession } from './pi-session.js';
import type {
  DirectHarnessSessionEvent,
  PromptInput,
} from '../../../../../domain/entities/direct-harness-session.js';

const PROMPT = {
  agent: 'builder',
  parts: [{ type: 'text', text: 'hi' }],
} as unknown as PromptInput;

function assistantMessageEnd(stopReason: string, errorMessage?: string): AgentSessionEvent {
  return {
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [],
      stopReason,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    },
  } as unknown as AgentSessionEvent;
}

/**
 * Fake AgentSession. Each prompt() call replays the next scripted list of events to the
 * subscribed listener, then resolves, which mirrors how the SDK resolves after a run.
 */
function fakeAgentSession(scripts: AgentSessionEvent[][]) {
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  const session = {
    subscribe: vi.fn((cb: (event: AgentSessionEvent) => void) => {
      listener = cb;
      return () => {
        listener = undefined;
      };
    }),
    prompt: vi.fn(async () => {
      for (const event of scripts.shift() ?? []) listener?.(event);
    }),
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };
  return session as unknown as AgentSession;
}

function createSession(agentSession: AgentSession) {
  const session = new PiSdkSession({
    session: agentSession,
    opencodeSessionId: 'pi-session-1',
    sessionTitle: 'test',
  });
  const events: DirectHarnessSessionEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { session, events };
}

describe('PiSdkSession provider errors', () => {
  it('rejects prompt() with the provider error and emits no session.idle', async () => {
    const { session, events } = createSession(
      fakeAgentSession([[assistantMessageEnd('error', 'Connection error.')]])
    );

    await expect(session.prompt(PROMPT)).rejects.toThrow('Connection error.');
    expect(events.map((e) => e.type)).not.toContain('session.idle');
  });

  it('resolves and emits session.idle when a retried error is followed by success', async () => {
    const { session, events } = createSession(
      fakeAgentSession([[assistantMessageEnd('error', 'overloaded'), assistantMessageEnd('stop')]])
    );

    await expect(session.prompt(PROMPT)).resolves.toBeUndefined();
    expect(events.map((e) => e.type)).toContain('session.idle');
  });

  it('is not poisoned by an earlier failed prompt', async () => {
    const { session, events } = createSession(
      fakeAgentSession([
        [assistantMessageEnd('error', 'Connection error.')],
        [assistantMessageEnd('stop')],
      ])
    );

    await expect(session.prompt(PROMPT)).rejects.toThrow('Connection error.');
    await expect(session.prompt(PROMPT)).resolves.toBeUndefined();
    expect(events.filter((e) => e.type === 'session.idle')).toHaveLength(1);
  });
});
