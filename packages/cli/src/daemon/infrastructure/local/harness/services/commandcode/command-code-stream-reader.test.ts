import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { CommandCodeStreamReader } from './command-code-stream-reader.js';

function makeReader(lines: string[]): CommandCodeStreamReader {
  const stream = new Readable({ read() {} });
  const reader = new CommandCodeStreamReader(stream);
  for (const line of lines) {
    stream.push(line + '\n');
  }
  stream.push(null);
  return reader;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('CommandCodeStreamReader', () => {
  describe('onText', () => {
    it('fires for each non-empty line', async () => {
      const texts: string[] = [];
      const reader = makeReader(['Hello world', 'Second line']);
      reader.onText((t) => texts.push(t));
      await flush();
      expect(texts).toEqual(['Hello world', 'Second line']);
    });

    it('does not fire for blank lines', async () => {
      const texts: string[] = [];
      const reader = makeReader(['', '   ', 'valid line']);
      reader.onText((t) => texts.push(t));
      await flush();
      expect(texts).toEqual(['valid line']);
    });

    it('does not fire for whitespace-only lines', async () => {
      const texts: string[] = [];
      const reader = makeReader(['\t\t', '  ', 'actual content']);
      reader.onText((t) => texts.push(t));
      await flush();
      expect(texts).toEqual(['actual content']);
    });

    it('fires for multiple callbacks on the same line', async () => {
      const a: string[] = [];
      const b: string[] = [];
      const reader = makeReader(['hello']);
      reader.onText((t) => a.push(t));
      reader.onText((t) => b.push(t));
      await flush();
      expect(a).toEqual(['hello']);
      expect(b).toEqual(['hello']);
    });
  });

  describe('onAnyEvent', () => {
    it('fires for every non-blank line', async () => {
      let count = 0;
      const reader = makeReader(['line one', 'line two', 'line three']);
      reader.onAnyEvent(() => count++);
      await flush();
      expect(count).toBe(3);
    });

    it('fires before onText for the same line', async () => {
      const order: string[] = [];
      const reader = makeReader(['test line']);
      reader.onAnyEvent(() => order.push('any'));
      reader.onText(() => order.push('text'));
      await flush();
      expect(order).toEqual(['any', 'text']);
    });

    it('does not fire for blank lines', async () => {
      let count = 0;
      const reader = makeReader(['', '  ', 'real line']);
      reader.onAnyEvent(() => count++);
      await flush();
      expect(count).toBe(1);
    });
  });

  describe('onAgentEnd', () => {
    it('fires exactly once when stream closes', async () => {
      let called = 0;
      const reader = makeReader(['some output']);
      reader.onAgentEnd(() => called++);
      await flush();
      expect(called).toBe(1);
    });

    it('fires even if no text was emitted', async () => {
      let called = 0;
      const reader = makeReader([]);
      reader.onAgentEnd(() => called++);
      await flush();
      expect(called).toBe(1);
    });

    it('fires after all text lines have been processed', async () => {
      const order: string[] = [];
      const reader = makeReader(['line one', 'line two']);
      reader.onText((t) => order.push(`text:${t}`));
      reader.onAgentEnd(() => order.push('end'));
      await flush();
      expect(order).toEqual(['text:line one', 'text:line two', 'end']);
    });
  });
});
