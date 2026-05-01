import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openCodeChunkExtractor } from './opencode-chunk-extractor.js';
import type { DirectHarnessSessionEvent } from '../../../domain/direct-harness/index.js';

function makeEvent(type: string, payload: unknown): DirectHarnessSessionEvent {
  return { type, payload, timestamp: 0 };
}

describe('openCodeChunkExtractor', () => {
  it('returns null for non message.part.updated events', () => {
    expect(openCodeChunkExtractor(makeEvent('session.idle', {}))).toBeNull();
    expect(openCodeChunkExtractor(makeEvent('tool.call', { name: 'bash' }))).toBeNull();
    expect(openCodeChunkExtractor(makeEvent('session.status', {}))).toBeNull();
  });

  it('returns null for message.part.updated with non-text part type', () => {
    const event = makeEvent('message.part.updated', {
      part: { type: 'tool', tool: 'bash' },
    });
    expect(openCodeChunkExtractor(event)).toBeNull();
  });

  it('returns delta when available and non-empty for text parts', () => {
    const event = makeEvent('message.part.updated', {
      part: { type: 'text', text: 'full text' },
      delta: 'delta chunk',
    });
    expect(openCodeChunkExtractor(event)).toBe('delta chunk');
  });

  it('falls back to part.text when delta is empty string', () => {
    const event = makeEvent('message.part.updated', {
      part: { type: 'text', text: 'full text' },
      delta: '',
    });
    expect(openCodeChunkExtractor(event)).toBe('full text');
  });

  it('returns text for reasoning part type', () => {
    const event = makeEvent('message.part.updated', {
      part: { type: 'reasoning', text: 'thinking...' },
    });
    expect(openCodeChunkExtractor(event)).toBe('thinking...');
  });

  it('returns null when text content is empty', () => {
    const event = makeEvent('message.part.updated', {
      part: { type: 'text', text: '' },
    });
    expect(openCodeChunkExtractor(event)).toBeNull();
  });
});
