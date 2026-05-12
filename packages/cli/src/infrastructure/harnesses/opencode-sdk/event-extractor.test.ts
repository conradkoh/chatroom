import { describe, it, expect } from 'vitest';
import { createOpencodeSdkChunkExtractor } from './event-extractor.js';
import type { DirectHarnessSessionEvent } from '../../../domain/direct-harness/entities/direct-harness-session.js';

function makePartUpdatedEvent(partId: string, messageID: string, type: string, delta: string): DirectHarnessSessionEvent {
  return {
    type: 'message.part.updated',
    payload: {
      part: { id: partId, messageID, type },
      delta,
    },
    timestamp: Date.now(),
  };
}

function makePartDeltaEvent(partID: string, messageID: string, delta: string): DirectHarnessSessionEvent {
  return {
    type: 'message.part.delta',
    payload: { partID, messageID, delta },
    timestamp: Date.now(),
  };
}

describe('createOpencodeSdkChunkExtractor', () => {
  it('extracts chunk from message.part.updated with delta', () => {
    const extract = createOpencodeSdkChunkExtractor();
    const event = makePartUpdatedEvent('p1', 'msg-1', 'text', 'Hello world');
    const result = extract(event);
    expect(result).toEqual({ content: 'Hello world', messageId: 'msg-1', partType: 'text' });
  });

  it('extracts reasoning chunk from message.part.updated with type=reasoning', () => {
    const extract = createOpencodeSdkChunkExtractor();
    const event = makePartUpdatedEvent('p1', 'msg-1', 'reasoning', 'Thinking...');
    const result = extract(event);
    expect(result).toEqual({ content: 'Thinking...', messageId: 'msg-1', partType: 'reasoning' });
  });

  it('returns null for message.part.updated without delta', () => {
    const extract = createOpencodeSdkChunkExtractor();
    const event: DirectHarnessSessionEvent = {
      type: 'message.part.updated',
      payload: { part: { id: 'p1', messageID: 'msg-1', type: 'text' } },
      timestamp: Date.now(),
    };
    const result = extract(event);
    expect(result).toBeNull();
  });

  it('extracts chunk from message.part.delta using partMap', () => {
    const extract = createOpencodeSdkChunkExtractor();
    // First register the part via message.part.updated (no delta)
    extract({
      type: 'message.part.updated',
      payload: { part: { id: 'p1', messageID: 'msg-1', type: 'reasoning' } },
      timestamp: Date.now(),
    });
    // Then extract via delta event
    const result = extract(makePartDeltaEvent('p1', 'msg-1', 'some delta'));
    expect(result).toEqual({ content: 'some delta', messageId: 'msg-1', partType: 'reasoning' });
  });

  it('same partID in message.part.updated with different deltas: all pass through (no dedup)', () => {
    const extract = createOpencodeSdkChunkExtractor();
    const event1 = makePartUpdatedEvent('p1', 'msg-1', 'text', 'Hello');
    const event2 = makePartUpdatedEvent('p1', 'msg-1', 'text', ' world');

    const first = extract(event1);
    const second = extract(event2);

    expect(first).toEqual({ content: 'Hello', messageId: 'msg-1', partType: 'text' });
    // Second event with same partId but different delta is NOT blocked anymore
    expect(second).toEqual({ content: ' world', messageId: 'msg-1', partType: 'text' });
  });

  it('does NOT deduplicate message.part.delta events (incremental streaming)', () => {
    const extract = createOpencodeSdkChunkExtractor();
    // Register part
    extract({
      type: 'message.part.updated',
      payload: { part: { id: 'p1', messageID: 'msg-1', type: 'text' } },
      timestamp: Date.now(),
    });

    // Multiple deltas for same part should all be extracted
    const d1 = extract(makePartDeltaEvent('p1', 'msg-1', 'chunk1'));
    const d2 = extract(makePartDeltaEvent('p1', 'msg-1', 'chunk2'));
    const d3 = extract(makePartDeltaEvent('p1', 'msg-1', 'chunk3'));

    expect(d1?.content).toBe('chunk1');
    expect(d2?.content).toBe('chunk2');
    expect(d3?.content).toBe('chunk3');
  });

  it('returns null for unknown event types', () => {
    const extract = createOpencodeSdkChunkExtractor();
    const result = extract({ type: 'session.idle', payload: {}, timestamp: Date.now() });
    expect(result).toBeNull();
  });
});
