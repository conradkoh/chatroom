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

  test('defines a page and the latest page', () => {
    const text = getHistoryRetrievalGuidance({
      chatroomId: 'room-1',
      role: 'planner',
      cliEnvPrefix: '',
    });
    expect(text).toContain('**Pages:**');
    expect(text).toContain('a page is one user message and everything after it');
    expect(text).toContain("Its id is that user message's id");
    expect(text).toContain('**latest page**');
  });

  test('teaches page commands: pages, download, before, page-id', () => {
    const text = getHistoryRetrievalGuidance({
      chatroomId: 'room-1',
      role: 'planner',
      cliEnvPrefix: '',
    });
    expect(text).toContain('chatroom messages pages --chatroom-id="room-1" --role="planner"');
    expect(text).toContain('chatroom messages download --chatroom-id="room-1" --role="planner"');
    expect(text).toContain('--before=1');
    expect(text).toContain('--page-id="<page-id>"');
  });

  test('names none of the removed history forms', () => {
    const text = getHistoryRetrievalGuidance({
      chatroomId: 'room-1',
      role: 'planner',
      cliEnvPrefix: '',
    });
    for (const forbidden of [
      'messages anchor',
      '--since-message-id',
      '--format=linear',
      '--limit=',
      'No cursor',
      'slice',
    ]) {
      expect(text).not.toContain(forbidden);
    }
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
    expect(text).toContain('messages pages');
  });
});
