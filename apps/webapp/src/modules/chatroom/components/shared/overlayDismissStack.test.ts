import { fireEvent } from '@testing-library/react';
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

  it('invokes only the top handler on escape', () => {
    const first = vi.fn();
    const second = vi.fn();

    pushOverlayDismiss(first);
    pushOverlayDismiss(second);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
