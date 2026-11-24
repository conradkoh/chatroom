import { describe, expect, it } from 'vitest';

import { getGeneralKnowledgeSections } from './general-knowledge';

describe('general knowledge sections', () => {
  it('composes glossary, history, commands, and recovery guidance', () => {
    const text = getGeneralKnowledgeSections({ chatroomId: 'room', role: 'builder', convexUrl: '' })
      .map((section) => section.content)
      .join('\n');
    expect(text).toContain('# Glossary');
    expect(text).toContain('`defragmentation` (1 skill available)');
    expect(text).toContain('`user-centricity` (1 skill available)');
    expect(text).toContain('`data-design` (1 skill available)');
    expect(text).not.toContain('`structural-decisions` (1 skill available)');
    expect(text).toContain('context read');
    expect(text).toContain('messages download');
    expect(text).toContain('truncated=true');
    expect(text).toContain('get-system-prompt');
    expect(text).toContain('get-role-guidance');
  });
  it('keeps the context-read reference for a non-verifier role', () => {
    const text = getGeneralKnowledgeSections({ chatroomId: 'room', role: 'builder', convexUrl: '' })
      .map((section) => section.content)
      .join('\n');
    expect(text).toContain('chatroom context read');
  });
  it('drops every context-read reference for the verifier', () => {
    const text = getGeneralKnowledgeSections({
      chatroomId: 'room',
      role: 'verifier',
      convexUrl: '',
    })
      .map((section) => section.content)
      .join('\n');
    expect(text).toContain('messages download');
    expect(text).toContain('messages anchor');
    expect(text).not.toMatch(/chatroom context|context read/i);
  });
  it('opens the verifier history-retrieval sentence with Run', () => {
    const text = getGeneralKnowledgeSections({
      chatroomId: 'room',
      role: 'verifier',
      convexUrl: '',
    })
      .map((section) => section.content)
      .join('\n');
    expect(text).toContain('**History retrieval:** Run `');
    expect(text).not.toMatch(/\*\*History retrieval:\*\* run /);
  });
  it('can omit history for wrappers', () => {
    expect(
      getGeneralKnowledgeSections(
        { chatroomId: 'room', role: 'enhancer', convexUrl: '' },
        { includeHistory: false }
      ).map((s) => s.id)
    ).not.toContain('history-retrieval');
  });
});
