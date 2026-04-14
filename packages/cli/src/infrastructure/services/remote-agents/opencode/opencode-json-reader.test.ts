import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { OpenCodeJsonReader } from './opencode-json-reader.js';

/** Push newline-delimited strings into the reader and return it. */
function makeReader(lines: string[]): OpenCodeJsonReader {
  const stream = new Readable({ read() {} });
  const reader = new OpenCodeJsonReader(stream);
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

describe('OpenCodeJsonReader', () => {
  describe('onText', () => {
    it('fires for text events with text content', async () => {
      const texts: string[] = [];
      const reader = makeReader([
        JSON.stringify({ type: 'text', part: { type: 'text', text: 'Hello.' } }),
        JSON.stringify({ type: 'text', part: { type: 'text', text: ' World.' } }),
      ]);
      reader.onText((t) => texts.push(t));
      await flush();
      expect(texts).toEqual(['Hello.', ' World.']);
    });

    it('does not fire for non-text events', async () => {
      const texts: string[] = [];
      const reader = makeReader([
        JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
      ]);
      reader.onText((t) => texts.push(t));
      await flush();
      expect(texts).toEqual([]);
    });

    it('handles text event with missing text field gracefully', async () => {
      const texts: string[] = [];
      const reader = makeReader([JSON.stringify({ type: 'text', part: { type: 'text' } })]);
      reader.onText((t) => texts.push(t));
      await flush();
      expect(texts).toEqual([]);
    });

    it('handles text event with non-string text gracefully', async () => {
      const texts: string[] = [];
      const reader = makeReader([
        JSON.stringify({ type: 'text', part: { type: 'text', text: 42 } }),
      ]);
      reader.onText((t) => texts.push(t));
      await flush();
      expect(texts).toEqual([]);
    });
  });

  describe('onToolUse', () => {
    it('fires for tool_use events', async () => {
      const parts: Record<string, unknown>[] = [];
      const reader = makeReader([
        JSON.stringify({ type: 'tool_use', part: { type: 'tool' } }),
      ]);
      reader.onToolUse((p) => parts.push(p));
      await flush();
      expect(parts).toEqual([{ type: 'tool' }]);
    });

    it('does not fire for text events', async () => {
      const parts: unknown[] = [];
      const reader = makeReader([
        JSON.stringify({ type: 'text', part: { type: 'text', text: 'hi' } }),
      ]);
      reader.onToolUse((p) => parts.push(p));
      await flush();
      expect(parts).toEqual([]);
    });
  });

  describe('onStepStart', () => {
    it('fires for step_start events', async () => {
      let called = 0;
      const reader = makeReader([
        JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
      ]);
      reader.onStepStart(() => called++);
      await flush();
      expect(called).toBe(1);
    });

    it('does not fire for other event types', async () => {
      let called = 0;
      const reader = makeReader([
        JSON.stringify({ type: 'text', part: { type: 'text', text: 'hi' } }),
        JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } }),
      ]);
      reader.onStepStart(() => called++);
      await flush();
      expect(called).toBe(0);
    });
  });

  describe('onStepFinish', () => {
    it('fires with reason "stop" on step_finish', async () => {
      const reasons: string[] = [];
      const reader = makeReader([
        JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } }),
      ]);
      reader.onStepFinish((r) => reasons.push(r));
      await flush();
      expect(reasons).toEqual(['stop']);
    });

    it('fires with reason "tool-calls" on step_finish', async () => {
      const reasons: string[] = [];
      const reader = makeReader([
        JSON.stringify({
          type: 'step_finish',
          part: { type: 'step-finish', reason: 'tool-calls' },
        }),
      ]);
      reader.onStepFinish((r) => reasons.push(r));
      await flush();
      expect(reasons).toEqual(['tool-calls']);
    });
  });

  describe('onAgentEnd', () => {
    it('fires when step_finish has reason "stop"', async () => {
      let called = 0;
      const reader = makeReader([
        JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } }),
      ]);
      reader.onAgentEnd(() => called++);
      await flush();
      expect(called).toBe(1);
    });

    it('does NOT fire when step_finish has reason "tool-calls"', async () => {
      let called = 0;
      const reader = makeReader([
        JSON.stringify({
          type: 'step_finish',
          part: { type: 'step-finish', reason: 'tool-calls' },
        }),
      ]);
      reader.onAgentEnd(() => called++);
      await flush();
      expect(called).toBe(0);
    });

    it('does not fire for other event types', async () => {
      let called = 0;
      const reader = makeReader([
        JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
        JSON.stringify({ type: 'text', part: { type: 'text', text: 'hi' } }),
        JSON.stringify({ type: 'tool_use', part: { type: 'tool' } }),
      ]);
      reader.onAgentEnd(() => called++);
      await flush();
      expect(called).toBe(0);
    });
  });

  describe('onAnyEvent', () => {
    it('fires for every parsed event regardless of type', async () => {
      let count = 0;
      const reader = makeReader([
        JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
        JSON.stringify({ type: 'text', part: { type: 'text', text: 'hello' } }),
        JSON.stringify({ type: 'tool_use', part: { type: 'tool' } }),
        JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } }),
      ]);
      reader.onAnyEvent(() => count++);
      await flush();
      expect(count).toBe(4);
    });

    it('fires before type-specific callbacks', async () => {
      const order: string[] = [];
      const reader = makeReader([
        JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } }),
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
        '\x1b[32mANSI banner\x1b[0m',
        JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
      ]);
      reader.onAnyEvent(() => count++);
      await flush();
      expect(count).toBe(1);
    });

    it('ignores blank lines silently', async () => {
      let count = 0;
      const reader = makeReader([
        '',
        '   ',
        JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
      ]);
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

    it('handles step_finish with missing part gracefully', async () => {
      const reasons: string[] = [];
      const reader = makeReader([JSON.stringify({ type: 'step_finish' })]);
      reader.onStepFinish((r) => reasons.push(r));
      await flush();
      expect(reasons).toEqual(['']);
    });

    it('handles multiple events on consecutive lines', async () => {
      const events: string[] = [];
      const reader = makeReader([
        JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
        JSON.stringify({ type: 'text', part: { type: 'text', text: 'a' } }),
        JSON.stringify({ type: 'tool_use', part: { type: 'tool' } }),
        JSON.stringify({
          type: 'step_finish',
          part: { type: 'step-finish', reason: 'tool-calls' },
        }),
        JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
        JSON.stringify({ type: 'text', part: { type: 'text', text: 'b' } }),
        JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } }),
      ]);
      reader.onAnyEvent(() => events.push('event'));
      reader.onText((t) => events.push(`text:${t}`));
      reader.onToolUse(() => events.push('tool'));
      reader.onStepFinish((r) => events.push(`finish:${r}`));
      reader.onAgentEnd(() => events.push('agent_end'));
      await flush();
      expect(events).toEqual([
        'event', // step_start
        'event', // text
        'text:a',
        'event', // tool_use
        'tool',
        'event', // step_finish tool-calls
        'finish:tool-calls',
        'event', // step_start
        'event', // text
        'text:b',
        'event', // step_finish stop
        'finish:stop',
        'agent_end',
      ]);
    });

    it('handles multiple callbacks registered', async () => {
      const a: string[] = [];
      const b: string[] = [];
      const reader = makeReader([
        JSON.stringify({ type: 'text', part: { type: 'text', text: 'hi' } }),
      ]);
      reader.onText((t) => a.push(t));
      reader.onText((t) => b.push(t));
      await flush();
      expect(a).toEqual(['hi']);
      expect(b).toEqual(['hi']);
    });
  });
});
