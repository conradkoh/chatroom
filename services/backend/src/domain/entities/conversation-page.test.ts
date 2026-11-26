import { describe, expect, it } from 'vitest';

import {
  MAX_PAGE_SPAN,
  PAGE_PREVIEW_MAX_CHARS,
  PAGE_START_SENDER_ROLE,
  PAGE_START_TYPE,
  startsPage,
} from './conversation-page';

describe('startsPage', () => {
  it('accepts a user-authored message row', () => {
    expect(startsPage({ senderRole: 'user', type: 'message' })).toBe(true);
  });

  it('is exact about the sender role case', () => {
    expect(startsPage({ senderRole: 'User', type: 'message' })).toBe(false);
  });

  it('rejects a handoff from the user role', () => {
    expect(startsPage({ senderRole: 'user', type: 'handoff' })).toBe(false);
  });

  it('rejects an agent message', () => {
    expect(startsPage({ senderRole: 'agent', type: 'message' })).toBe(false);
  });
});

describe('page constants', () => {
  it('pins the start identity and preview/spans', () => {
    expect(PAGE_START_SENDER_ROLE).toBe('user');
    expect(PAGE_START_TYPE).toBe('message');
    expect(PAGE_PREVIEW_MAX_CHARS).toBe(120);
    expect(MAX_PAGE_SPAN).toBe(50);
  });
});
