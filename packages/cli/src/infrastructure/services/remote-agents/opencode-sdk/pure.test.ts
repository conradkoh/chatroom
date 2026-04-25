import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { forwardFiltered, isInfoLine, parseModelId } from './pure.js';

describe('parseModelId', () => {
  it('parses single-slash model id', () => {
    expect(parseModelId('anthropic/claude-sonnet-4')).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4',
    });
  });

  it('splits on first slash only, preserving trailing path in modelID', () => {
    expect(parseModelId('anthropic/claude-sonnet-4.5/thinking')).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4.5/thinking',
    });
  });

  it('returns undefined for model without slash', () => {
    expect(parseModelId('no-slash-here')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseModelId('')).toBeUndefined();
  });

  it('returns undefined for leading slash', () => {
    expect(parseModelId('/foo')).toBeUndefined();
  });

  it('returns undefined for trailing slash', () => {
    expect(parseModelId('foo/')).toBeUndefined();
  });
});

describe('forwardFiltered', () => {
  function makeFakeSource() {
    return new EventEmitter() as unknown as NodeJS.ReadableStream;
  }

  function makeFakeTarget() {
    const writes: string[] = [];
    return {
      writes,
      write: vi.fn((s: string) => {
        writes.push(s);
        return true;
      }),
    };
  }

  it('forwards whole line that should be kept', () => {
    const source = makeFakeSource();
    const target = makeFakeTarget();
    forwardFiltered(source, target as unknown as NodeJS.WritableStream, (line) => line === 'DROP');
    source.emit('data', 'keep\n');
    source.emit('end');
    expect(target.writes).toEqual(['keep\n']);
  });

  it('drops line that matches shouldDrop', () => {
    const source = makeFakeSource();
    const target = makeFakeTarget();
    forwardFiltered(source, target as unknown as NodeJS.WritableStream, (line) => line === 'DROP');
    source.emit('data', 'DROP\n');
    source.emit('end');
    expect(target.writes).toEqual([]);
  });

  it('handles line split across two data chunks', () => {
    const source = makeFakeSource();
    const target = makeFakeTarget();
    forwardFiltered(source, target as unknown as NodeJS.WritableStream, () => false);
    source.emit('data', 'hello ');
    source.emit('data', 'world\n');
    source.emit('end');
    expect(target.writes).toEqual(['hello world\n']);
  });

  it('handles chunk with multiple newlines', () => {
    const source = makeFakeSource();
    const target = makeFakeTarget();
    forwardFiltered(source, target as unknown as NodeJS.WritableStream, (line) => line === 'SKIP');
    source.emit('data', 'one\nSKIP\ntwo\n');
    source.emit('end');
    expect(target.writes).toEqual(['one\n', 'two\n']);
  });

  it('does nothing when source is undefined', () => {
    const target = makeFakeTarget();
    forwardFiltered(undefined, target as unknown as NodeJS.WritableStream, () => false);
    expect(target.write).not.toHaveBeenCalled();
  });

  it('flushes partial buffer on end when not dropped', () => {
    const source = makeFakeSource();
    const target = makeFakeTarget();
    forwardFiltered(source, target as unknown as NodeJS.WritableStream, () => false);
    source.emit('data', 'partial');
    source.emit('end');
    expect(target.writes).toEqual(['partial']);
  });

  it('drops partial buffer on end when matches shouldDrop', () => {
    const source = makeFakeSource();
    const target = makeFakeTarget();
    forwardFiltered(
      source,
      target as unknown as NodeJS.WritableStream,
      (line) => line === 'partial'
    );
    source.emit('data', 'partial');
    source.emit('end');
    expect(target.writes).toEqual([]);
  });
});

describe('isInfoLine', () => {
  it('returns true for INFO-prefixed line', () => {
    expect(isInfoLine('INFO foo')).toBe(true);
  });

  it('returns true for INFO with multiple spaces', () => {
    expect(isInfoLine('INFO  foo')).toBe(true);
  });

  it('returns true for INFO with leading whitespace', () => {
    expect(isInfoLine('  INFO foo')).toBe(true);
  });

  it('returns false for INFO without trailing space', () => {
    expect(isInfoLine('INFO')).toBe(false);
  });

  it('returns false for INF (no trailing space)', () => {
    expect(isInfoLine('INFOR foo')).toBe(false);
  });

  it('returns false for WARN-prefixed line', () => {
    expect(isInfoLine('WARN foo')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isInfoLine('')).toBe(false);
  });
});
