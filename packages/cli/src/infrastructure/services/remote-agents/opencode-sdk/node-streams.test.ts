import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { forwardFiltered } from './node-streams.js';

describe('forwardFiltered', () => {
  function makeFakeSource() {
    return new EventEmitter() as unknown as Readable;
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
    forwardFiltered(source, target as unknown as Writable, (line) => line === 'DROP');
    source.emit('data', 'keep\n');
    source.emit('end');
    expect(target.writes).toEqual(['keep\n']);
  });

  it('drops line that matches shouldDrop', () => {
    const source = makeFakeSource();
    const target = makeFakeTarget();
    forwardFiltered(source, target as unknown as Writable, (line) => line === 'DROP');
    source.emit('data', 'DROP\n');
    source.emit('end');
    expect(target.writes).toEqual([]);
  });

  it('handles line split across two data chunks', () => {
    const source = makeFakeSource();
    const target = makeFakeTarget();
    forwardFiltered(source, target as unknown as Writable, () => false);
    source.emit('data', 'hello ');
    source.emit('data', 'world\n');
    source.emit('end');
    expect(target.writes).toEqual(['hello world\n']);
  });

  it('handles chunk with multiple newlines', () => {
    const source = makeFakeSource();
    const target = makeFakeTarget();
    forwardFiltered(source, target as unknown as Writable, (line) => line === 'SKIP');
    source.emit('data', 'one\nSKIP\ntwo\n');
    source.emit('end');
    expect(target.writes).toEqual(['one\n', 'two\n']);
  });

  it('does nothing when source is undefined', () => {
    const target = makeFakeTarget();
    forwardFiltered(undefined, target as unknown as Writable, () => false);
    expect(target.write).not.toHaveBeenCalled();
  });

  it('flushes partial buffer on end when not dropped', () => {
    const source = makeFakeSource();
    const target = makeFakeTarget();
    forwardFiltered(source, target as unknown as Writable, () => false);
    source.emit('data', 'partial');
    source.emit('end');
    expect(target.writes).toEqual(['partial']);
  });

  it('drops partial buffer on end when matches shouldDrop', () => {
    const source = makeFakeSource();
    const target = makeFakeTarget();
    forwardFiltered(source, target as unknown as Writable, (line) => line === 'partial');
    source.emit('data', 'partial');
    source.emit('end');
    expect(target.writes).toEqual([]);
  });
});
