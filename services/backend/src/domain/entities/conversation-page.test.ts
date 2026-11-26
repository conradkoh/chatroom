import { describe, expect, it } from 'vitest';

import {
  clampPageSpan,
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

describe('clampPageSpan', () => {
  it('treats an omitted count as zero', () => {
    expect(clampPageSpan(undefined)).toBe(0);
  });

  it('treats a non-finite count as zero', () => {
    expect(clampPageSpan(NaN)).toBe(0);
  });

  it('clamps a negative count to zero', () => {
    expect(clampPageSpan(-3)).toBe(0);
  });

  it('floors a fractional count', () => {
    expect(clampPageSpan(2.9)).toBe(2);
  });

  it('passes a count within the span through', () => {
    expect(clampPageSpan(50)).toBe(50);
  });

  it('caps a count above the maximum span', () => {
    expect(clampPageSpan(999)).toBe(50);
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
