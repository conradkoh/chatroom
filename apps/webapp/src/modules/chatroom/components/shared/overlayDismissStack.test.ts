import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isTopOverlayDismiss,
  popOverlayDismiss,
  pushOverlayDismiss,
  resetOverlayDismissStackForTests,
} from './overlayDismissStack';

describe('overlayDismissStack', () => {
  afterEach(() => {
    resetOverlayDismissStackForTests();
  });

  it('tracks topmost dismiss handler in open order', () => {
    const first = vi.fn();
    const second = vi.fn();

    pushOverlayDismiss(first);
    pushOverlayDismiss(second);

    expect(isTopOverlayDismiss(first)).toBe(false);
    expect(isTopOverlayDismiss(second)).toBe(true);
  });

  it('restores previous top after pop', () => {
    const first = vi.fn();
    const second = vi.fn();

    pushOverlayDismiss(first);
    pushOverlayDismiss(second);
    popOverlayDismiss(second);

    expect(isTopOverlayDismiss(first)).toBe(true);
  });
});
