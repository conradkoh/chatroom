import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jumpToPlanAnchor, planAnchorId, planPhaseRef, shortPlanId } from './timelinePlanAnchors';

describe('planAnchorId', () => {
  it('builds a stable element id from the message id and key', () => {
    expect(planAnchorId('m1', 'P2')).toBe('plan-m1-P2');
    expect(planAnchorId('m1', 'phases')).toBe('plan-m1-phases');
  });
});

describe('planPhaseRef', () => {
  it('builds the copyable phase reference', () => {
    expect(planPhaseRef('m1', 'P2')).toBe('m1#P2');
  });
});

describe('shortPlanId', () => {
  it('renders ids of 12 characters or fewer in full', () => {
    expect(shortPlanId('7f3ksa12a9d2')).toBe('7f3ksa12a9d2');
    expect(shortPlanId('abc')).toBe('abc');
  });

  it('elides ids longer than 12 characters to first 6 and last 4', () => {
    expect(shortPlanId('7f3ksa12a9d2e')).toBe('7f3ksa…9d2e');
    expect(shortPlanId('7f3ksa12a9d2ef')).toBe('7f3ksa…d2ef');
  });
});

describe('jumpToPlanAnchor', () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
  });

  afterEach(() => {
    document.body.innerHTML = '';
    Element.prototype.scrollIntoView = originalScrollIntoView;
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('is a no-op for a missing target', () => {
    expect(() => jumpToPlanAnchor('plan-missing-P1')).not.toThrow();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('scrolls to the target heading and focuses it without changing the hash', () => {
    const target = document.createElement('h4');
    target.id = 'plan-m1-P2';
    target.tabIndex = -1;
    document.body.appendChild(target);

    jumpToPlanAnchor('plan-m1-P2');

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    expect(document.activeElement).toBe(target);
    expect(window.location.hash).toBe('');
  });

  it('uses instant scrolling under prefers-reduced-motion', () => {
    window.matchMedia = vi.fn().mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList
    );
    const target = document.createElement('h4');
    target.id = 'plan-m1-P1';
    target.tabIndex = -1;
    document.body.appendChild(target);

    jumpToPlanAnchor('plan-m1-P1');

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  });
});
