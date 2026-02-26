import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { PiRpcReader } from './pi-rpc-reader.js';

/** Push newline-delimited strings into the reader and return it. */
function makeReader(lines: string[]): PiRpcReader {
  const stream = new Readable({ read() {} });
  const reader = new PiRpcReader(stream);
  for (const line of lines) {
    stream.push(line + '\n');
  }
  stream.push(null); // EOF
  return reader;
}

/**
 * Wait for all pending microtasks / readline events to flush.
 * readline emits 'line' asynchronously so we need at least one tick.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('PiRpcReader', () => {
  describe('onTextDelta', () => {
    it('fires for message_update text_delta events', async () => {
      const deltas: string[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
        }),
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: ' world' },
        }),
      ]);
      reader.onTextDelta((d) => deltas.push(d));
      await flush();
      expect(deltas).toEqual(['Hello', ' world']);
    });

    it('does not fire for message_update events with non-text_delta type', async () => {
      const deltas: string[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', delta: 'thinking...' },
        }),
      ]);
      reader.onTextDelta((d) => deltas.push(d));
      await flush();
      expect(deltas).toEqual([]);
    });
  });

  describe('onThinkingDelta', () => {
    it('fires for message_update thinking_delta events', async () => {
      const deltas: string[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', delta: 'The user' },
        }),
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', delta: ' wants X.' },
        }),
      ]);
      reader.onThinkingDelta((d) => deltas.push(d));
      await flush();
      expect(deltas).toEqual(['The user', ' wants X.']);
    });

    it('does not fire for text_delta events', async () => {
      const deltas: string[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
        }),
      ]);
      reader.onThinkingDelta((d) => deltas.push(d));
      await flush();
      expect(deltas).toEqual([]);
    });

    it('fires onAnyEvent for thinking_delta events', async () => {
      let count = 0;
      const reader = makeReader([
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', delta: 'thinking' },
        }),
      ]);
      reader.onAnyEvent(() => count++);
      await flush();
      expect(count).toBe(1);
    });
    it('does not fire for unrelated event types', async () => {
      const deltas: string[] = [];
      const reader = makeReader([JSON.stringify({ type: 'agent_start' })]);
      reader.onTextDelta((d) => deltas.push(d));
      await flush();
      expect(deltas).toEqual([]);
    });

    it('handles multiple callbacks registered', async () => {
      const a: string[] = [];
      const b: string[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'hi' },
        }),
      ]);
      reader.onTextDelta((d) => a.push(d));
      reader.onTextDelta((d) => b.push(d));
      await flush();
      expect(a).toEqual(['hi']);
      expect(b).toEqual(['hi']);
    });
  });

  describe('onAgentEnd', () => {
    it('fires when agent_end event is received', async () => {
      let called = 0;
      const reader = makeReader([JSON.stringify({ type: 'agent_end' })]);
      reader.onAgentEnd(() => called++);
      await flush();
      expect(called).toBe(1);
    });

    it('does not fire for other event types', async () => {
      let called = 0;
      const reader = makeReader([JSON.stringify({ type: 'agent_start' })]);
      reader.onAgentEnd(() => called++);
      await flush();
      expect(called).toBe(0);
    });
  });

  describe('onToolCall', () => {
    it('fires with tool name and args on tool_execution_start', async () => {
      const calls: { name: string; args: unknown }[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'tool_execution_start',
          toolName: 'bash',
          toolArgs: { command: 'ls' },
        }),
      ]);
      reader.onToolCall((name, args) => calls.push({ name, args }));
      await flush();
      expect(calls).toEqual([{ name: 'bash', args: { command: 'ls' } }]);
    });

    it('does not fire for tool_execution_end', async () => {
      const calls: unknown[] = [];
      const reader = makeReader([JSON.stringify({ type: 'tool_execution_end', toolName: 'bash' })]);
      reader.onToolCall((...args) => calls.push(args));
      await flush();
      expect(calls).toEqual([]);
    });
  });

  describe('onAnyEvent', () => {
    it('fires for every parsed event regardless of type', async () => {
      let count = 0;
      const reader = makeReader([
        JSON.stringify({ type: 'agent_start' }),
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'x' },
        }),
        JSON.stringify({ type: 'agent_end' }),
      ]);
      reader.onAnyEvent(() => count++);
      await flush();
      expect(count).toBe(3);
    });

    it('fires before type-specific callbacks', async () => {
      const order: string[] = [];
      const reader = makeReader([JSON.stringify({ type: 'agent_end' })]);
      reader.onAnyEvent(() => order.push('any'));
      reader.onAgentEnd(() => order.push('end'));
      await flush();
      expect(order).toEqual(['any', 'end']);
    });
  });

  describe('robustness', () => {
    it('ignores non-JSON lines silently', async () => {
      let count = 0;
      const reader = makeReader(['not json at all', JSON.stringify({ type: 'agent_end' })]);
      reader.onAnyEvent(() => count++);
      reader.onAgentEnd(() => count++);
      await flush();
      // Only the valid JSON line should fire (anyEvent + agentEnd = 2)
      expect(count).toBe(2);
    });

    it('ignores blank lines silently', async () => {
      let count = 0;
      const reader = makeReader(['', '   ', JSON.stringify({ type: 'agent_end' })]);
      reader.onAnyEvent(() => count++);
      await flush();
      expect(count).toBe(1);
    });

    it('handles unknown event types without throwing', async () => {
      const fn = vi.fn();
      const reader = makeReader([JSON.stringify({ type: 'some_future_event', data: 42 })]);
      reader.onAnyEvent(fn);
      await flush();
      expect(fn).toHaveBeenCalledOnce();
    });

    it('handles message_update with missing assistantMessageEvent gracefully', async () => {
      const deltas: string[] = [];
      const reader = makeReader([JSON.stringify({ type: 'message_update' })]);
      reader.onTextDelta((d) => deltas.push(d));
      await flush();
      expect(deltas).toEqual([]);
    });

    it('handles message_update where delta is not a string gracefully', async () => {
      const deltas: string[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 42 },
        }),
      ]);
      reader.onTextDelta((d) => deltas.push(d));
      await flush();
      expect(deltas).toEqual([]);
    });

    it('handles multiple events on consecutive lines', async () => {
      const events: string[] = [];
      const reader = makeReader([
        JSON.stringify({ type: 'agent_start' }),
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'a' },
        }),
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'b' },
        }),
        JSON.stringify({ type: 'agent_end' }),
      ]);
      reader.onAnyEvent(() => events.push('event'));
      reader.onTextDelta((d) => events.push(`delta:${d}`));
      reader.onAgentEnd(() => events.push('end'));
      await flush();
      expect(events).toEqual([
        'event', // agent_start  → anyEvent
        'event', // message_update → anyEvent
        'delta:a', // message_update → textDelta
        'event', // message_update → anyEvent
        'delta:b', // message_update → textDelta
        'event', // agent_end → anyEvent
        'end', // agent_end → agentEnd
      ]);
    });
  });
});
