import { describe, expect, it } from 'vitest';

import { MessageBuffer } from './message-buffer.js';

describe('MessageBuffer', () => {
  it('enqueues and dequeues in fifo key order', () => {
    const buffer = new MessageBuffer(
      { maxSize: 10 },
      (item: { id: string; key: string }) => item.key
    );

    buffer.enqueue([
      { id: 'b', key: '002' },
      { id: 'a', key: '001' },
      { id: 'c', key: '003' },
    ]);

    expect(buffer.dequeue()?.id).toBe('a');
    expect(buffer.dequeue()?.id).toBe('b');
    expect(buffer.dequeue()?.id).toBe('c');
  });

  it('dedupes items with the same key while in buffer', () => {
    const buffer = new MessageBuffer(
      { maxSize: 10, dedupe: true },
      (item: { key: string }) => item.key
    );

    expect(buffer.enqueue([{ key: '1' }, { key: '1' }])).toBe(1);
    expect(buffer.size()).toBe(1);
  });

  it('dedupes recently acked items when dedupeTtlMs is set', () => {
    const buffer = new MessageBuffer(
      { maxSize: 10, dedupe: true, dedupeTtlMs: 60_000 },
      (item: { key: string }) => item.key
    );

    buffer.enqueue([{ key: '1' }]);
    const item = buffer.dequeue();
    expect(item).toEqual({ key: '1' });
    buffer.ack('1');

    expect(buffer.enqueue([{ key: '1' }])).toBe(0);
  });

  it('requeues on nack when requeue is true', () => {
    const buffer = new MessageBuffer(
      { maxSize: 10 },
      (item: { key: string; value: number }) => item.key
    );

    buffer.enqueue([{ key: '1', value: 42 }]);
    buffer.dequeue();
    buffer.nack('1', true);

    expect(buffer.dequeue()).toEqual({ key: '1', value: 42 });
  });

  it('drops oldest items when maxSize is exceeded', () => {
    const buffer = new MessageBuffer({ maxSize: 2 }, (item: { key: string }) => item.key);

    buffer.enqueue([{ key: '001' }, { key: '002' }, { key: '003' }]);
    expect(buffer.size()).toBe(2);
    expect(buffer.dequeue()).toEqual({ key: '002' });
  });

  it('computes highKeyOf from items', () => {
    const buffer = new MessageBuffer({ maxSize: 10 }, (item: { key: string }) => item.key);

    expect(buffer.highKeyOf([{ key: '001' }, { key: '003' }, { key: '002' }])).toBe('003');
    expect(buffer.highKeyOf([])).toBeNull();
  });
});
