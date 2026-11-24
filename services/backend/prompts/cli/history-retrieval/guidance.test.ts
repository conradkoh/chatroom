import { describe, expect, test } from 'vitest';

import { getHistoryRetrievalGuidance } from './guidance';

describe('getHistoryRetrievalGuidance', () => {
  test('includes source priority and truncation guidance', () => {
    const text = getHistoryRetrievalGuidance({
      chatroomId: 'room-1',
      role: 'planner',
      cliEnvPrefix: '',
    });
    expect(text).not.toMatch(/chatroom context|context read/i);
    expect(text).toContain('messages download');
    expect(text).toContain('truncated=true');
    expect(text).toContain('absolute path printed by the CLI');
  });

  test('includes messages anchor and since-message-id download', () => {
    const text = getHistoryRetrievalGuidance({
      chatroomId: 'room-1',
      role: 'planner',
      cliEnvPrefix: '',
    });
    expect(text).toContain('messages anchor');
    expect(text).toContain('--since-message-id="<id-from-anchor>" --limit=100');
  });

  test('renders the same source bullets for the verifier and other roles', () => {
    const render = (role: string) =>
      getHistoryRetrievalGuidance({ chatroomId: 'room-1', role, cliEnvPrefix: '' });
    expect(render('builder').replaceAll('builder', '<role>')).toBe(
      render('verifier').replaceAll('verifier', '<role>')
    );
  });

  test('names no removed context command', () => {
    const text = getHistoryRetrievalGuidance({
      chatroomId: 'room-1',
      role: 'verifier',
      cliEnvPrefix: '',
    });
    expect(text).not.toMatch(/chatroom context|context read/i);
    expect(text).toContain('messages download');
    expect(text).toContain('messages anchor');
  });
});
