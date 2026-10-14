import { describe, it, expect } from 'vitest';

import { createOpencodeSdkChunkExtractor } from './event-extractor.js';
import type { DirectHarnessSessionEvent } from '../../../../../domain/entities/direct-harness-session.js';

function deltaEvent(
  type: 'session.text.delta' | 'session.reasoning.delta',
  assistantMessageID: string,
  delta: string
): DirectHarnessSessionEvent {
  return {
    type,
    payload: { sessionID: 'sess-1', assistantMessageID, ordinal: 0, delta },
    timestamp: Date.now(),
  };
}

describe('createOpencodeSdkChunkExtractor', () => {
  it('extracts a text chunk from session.text.delta', () => {
    const extract = createOpencodeSdkChunkExtractor();
    const result = extract(deltaEvent('session.text.delta', 'msg-1', 'Hello world'));
    expect(result).toEqual({ content: 'Hello world', messageId: 'msg-1', partType: 'text' });
  });

  it('extracts a reasoning chunk from session.reasoning.delta', () => {
    const extract = createOpencodeSdkChunkExtractor();
    const result = extract(deltaEvent('session.reasoning.delta', 'msg-1', 'Thinking...'));
    expect(result).toEqual({ content: 'Thinking...', messageId: 'msg-1', partType: 'reasoning' });
  });

  it('returns null when delta is empty', () => {
    const extract = createOpencodeSdkChunkExtractor();
    expect(extract(deltaEvent('session.text.delta', 'msg-1', ''))).toBeNull();
  });

  it('returns null when assistantMessageID is absent', () => {
    const extract = createOpencodeSdkChunkExtractor();
    const event: DirectHarnessSessionEvent = {
      type: 'session.text.delta',
      payload: { sessionID: 'sess-1', delta: 'orphan' },
      timestamp: Date.now(),
    };
    expect(extract(event)).toBeNull();
  });

  it('does NOT deduplicate incremental deltas for the same message', () => {
    const extract = createOpencodeSdkChunkExtractor();
    expect(extract(deltaEvent('session.text.delta', 'msg-1', 'chunk1'))?.content).toBe('chunk1');
    expect(extract(deltaEvent('session.text.delta', 'msg-1', 'chunk2'))?.content).toBe('chunk2');
    expect(extract(deltaEvent('session.text.delta', 'msg-1', 'chunk3'))?.content).toBe('chunk3');
  });

  it('returns null for unknown event types', () => {
    const extract = createOpencodeSdkChunkExtractor();
    const result = extract({ type: 'session.idle', payload: {}, timestamp: Date.now() });
    expect(result).toBeNull();
  });
});
