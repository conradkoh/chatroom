import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { CursorStreamReader } from './cursor-stream-reader.js';

function makeReader(lines: string[]): CursorStreamReader {
  const stream = new Readable({ read() {} });
  const reader = new CursorStreamReader(stream);
  for (const line of lines) {
    stream.push(line + '\n');
  }
  stream.push(null);
  return reader;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('CursorStreamReader', () => {
  describe('onText', () => {
    it('fires for assistant message content', async () => {
      const texts: string[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        }),
      ]);
      reader.onText((t) => texts.push(t));
      await flush();
      expect(texts).toEqual(['Hello world']);
    });

    it('fires for each content block with type text', async () => {
      const texts: string[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'First' },
              { type: 'text', text: 'Second' },
            ],
          },
        }),
      ]);
      reader.onText((t) => texts.push(t));
      await flush();
      expect(texts).toEqual(['First', 'Second']);
    });

    it('does not fire for non-assistant events', async () => {
      const texts: string[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'user input' }],
          },
        }),
      ]);
      reader.onText((t) => texts.push(t));
      await flush();
      expect(texts).toEqual([]);
    });

    it('handles assistant message with no content array gracefully', async () => {
      const texts: string[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant' },
        }),
      ]);
      reader.onText((t) => texts.push(t));
      await flush();
      expect(texts).toEqual([]);
    });

    it('handles multiple callbacks', async () => {
      const a: string[] = [];
      const b: string[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
          },
        }),
      ]);
      reader.onText((t) => a.push(t));
      reader.onText((t) => b.push(t));
      await flush();
      expect(a).toEqual(['hi']);
      expect(b).toEqual(['hi']);
    });
  });

  describe('onAgentEnd', () => {
    it('fires when result event with subtype success is received', async () => {
      const sessionIds: (string | undefined)[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          duration_ms: 1234,
          session_id: 'abc-123',
        }),
      ]);
      reader.onAgentEnd((sid) => sessionIds.push(sid));
      await flush();
      expect(sessionIds).toEqual(['abc-123']);
    });

    it('does not fire for result events with non-success subtype', async () => {
      let called = 0;
      const reader = makeReader([
        JSON.stringify({
          type: 'result',
          subtype: 'error',
        }),
      ]);
      reader.onAgentEnd(() => called++);
      await flush();
      expect(called).toBe(0);
    });

    it('does not fire for non-result event types', async () => {
      let called = 0;
      const reader = makeReader([JSON.stringify({ type: 'system', subtype: 'init' })]);
      reader.onAgentEnd(() => called++);
      await flush();
      expect(called).toBe(0);
    });
  });

  describe('onToolCall', () => {
    it('fires with call_id and tool_call on tool_call started', async () => {
      const calls: { callId: string; toolCall: unknown }[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'tool_call',
          subtype: 'started',
          call_id: 'call-1',
          tool_call: { readToolCall: { args: { path: 'file.txt' } } },
        }),
      ]);
      reader.onToolCall((callId, toolCall) => calls.push({ callId, toolCall }));
      await flush();
      expect(calls).toEqual([
        { callId: 'call-1', toolCall: { readToolCall: { args: { path: 'file.txt' } } } },
      ]);
    });

    it('does not fire for tool_call completed', async () => {
      const calls: unknown[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'tool_call',
          subtype: 'completed',
          call_id: 'call-1',
          tool_call: {},
        }),
      ]);
      reader.onToolCall((...args) => calls.push(args));
      await flush();
      expect(calls).toEqual([]);
    });
  });

  describe('onToolResult', () => {
    it('fires with call_id and tool_call on tool_call completed', async () => {
      const results: { callId: string; toolCall: unknown }[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'tool_call',
          subtype: 'completed',
          call_id: 'call-1',
          tool_call: {
            readToolCall: {
              args: { path: 'file.txt' },
              result: { success: { totalLines: 10 } },
            },
          },
        }),
      ]);
      reader.onToolResult((callId, toolCall) => results.push({ callId, toolCall }));
      await flush();
      expect(results).toEqual([
        {
          callId: 'call-1',
          toolCall: {
            readToolCall: {
              args: { path: 'file.txt' },
              result: { success: { totalLines: 10 } },
            },
          },
        },
      ]);
    });

    it('does not fire for tool_call started', async () => {
      const results: unknown[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'tool_call',
          subtype: 'started',
          call_id: 'call-1',
          tool_call: {},
        }),
      ]);
      reader.onToolResult((...args) => results.push(args));
      await flush();
      expect(results).toEqual([]);
    });
  });

  describe('onAnyEvent', () => {
    it('fires for every parsed event regardless of type', async () => {
      let count = 0;
      const reader = makeReader([
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
        }),
        JSON.stringify({ type: 'result', subtype: 'success' }),
      ]);
      reader.onAnyEvent(() => count++);
      await flush();
      expect(count).toBe(3);
    });

    it('fires before type-specific callbacks', async () => {
      const order: string[] = [];
      const reader = makeReader([
        JSON.stringify({ type: 'result', subtype: 'success', session_id: 's1' }),
      ]);
      reader.onAnyEvent(() => order.push('any'));
      reader.onAgentEnd(() => order.push('end'));
      await flush();
      expect(order).toEqual(['any', 'end']);
    });
  });

  describe('robustness', () => {
    it('ignores non-JSON lines silently', async () => {
      let count = 0;
      const reader = makeReader([
        'not json at all',
        JSON.stringify({ type: 'result', subtype: 'success' }),
      ]);
      reader.onAnyEvent(() => count++);
      reader.onAgentEnd(() => count++);
      await flush();
      expect(count).toBe(2);
    });

    it('ignores blank lines silently', async () => {
      let count = 0;
      const reader = makeReader([
        '',
        '   ',
        JSON.stringify({ type: 'result', subtype: 'success' }),
      ]);
      reader.onAnyEvent(() => count++);
      await flush();
      expect(count).toBe(1);
    });

    it('handles unknown event types without throwing', async () => {
      const fn = vi.fn();
      const reader = makeReader([JSON.stringify({ type: 'future_event', data: 42 })]);
      reader.onAnyEvent(fn);
      await flush();
      expect(fn).toHaveBeenCalledOnce();
    });

    it('handles full Cursor stream sequence', async () => {
      const events: string[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'system',
          subtype: 'init',
          model: 'Claude 4 Sonnet',
          session_id: 's1',
        }),
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: 'do work' }] },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: "I'll read the file" }],
          },
        }),
        JSON.stringify({
          type: 'tool_call',
          subtype: 'started',
          call_id: 'c1',
          tool_call: { readToolCall: { args: { path: 'README.md' } } },
        }),
        JSON.stringify({
          type: 'tool_call',
          subtype: 'completed',
          call_id: 'c1',
          tool_call: { readToolCall: { args: { path: 'README.md' }, result: { success: {} } } },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Done!' }],
          },
        }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          duration_ms: 5000,
          session_id: 's1',
        }),
      ]);

      reader.onAnyEvent(() => events.push('event'));
      reader.onText((t) => events.push(`text:${t}`));
      reader.onToolCall((id) => events.push(`tool_start:${id}`));
      reader.onToolResult((id) => events.push(`tool_done:${id}`));
      reader.onAgentEnd((sid) => events.push(`end:${sid}`));

      await flush();

      expect(events).toEqual([
        'event', // system init
        'event', // user message
        'event', // assistant
        "text:I'll read the file",
        'event', // tool_call started
        'tool_start:c1',
        'event', // tool_call completed
        'tool_done:c1',
        'event', // assistant
        'text:Done!',
        'event', // result
        'end:s1',
      ]);
    });
  });
});
