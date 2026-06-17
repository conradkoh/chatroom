/**
 * TimelineScrollCoordinator — programmatic scroll target-check behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TimelineScrollCoordinator } from './timelineScrollCoordinator';

function createCoordinator(initialPinned = true): TimelineScrollCoordinator {
  return new TimelineScrollCoordinator(initialPinned);
}

function flushRaf(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

describe('TimelineScrollCoordinator runProgrammaticScroll with targetCheck', () => {
  let coordinator: TimelineScrollCoordinator;

  beforeEach(() => {
    coordinator = createCoordinator();
  });

  afterEach(() => {
    coordinator.detach();
  });

  it('clears programmaticScroll when targetCheck resolves true before frame cap', async () => {
    const el = {
      scrollTop: 0,
      scrollHeight: 1200,
      clientHeight: 400,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as HTMLElement;

    coordinator.attach(el);

    // Initially no programmatic scroll is active
    expect(coordinator.isProgrammaticScrollActive()).toBe(false);

    // jumpToEnd uses runProgrammaticScroll with targetCheck: () => this.computeIsAtBottom()
    // With scrollHeight=1200, scrollTop=0, clientHeight=400:
    //   scrollHeight - scrollTop - clientHeight = 1200 - 0 - 400 = 800, which is > threshold
    // So computeIsAtBottom returns false, and the frame cap will eventually clear it.
    // For the happy path, set dimensions so we ARE at bottom:
    Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true });

    coordinator.jumpToEnd();

    // Should be active right after the call
    expect(coordinator.isProgrammaticScrollActive()).toBe(true);

    // Wait for 2 rAFs to pass (enough for targetCheck to resolve)
    await flushRaf();

    // After targetCheck resolves (at bottom: 500 - 0 - 400 = 100 < threshold),
    // programmaticScroll should be cleared
    expect(coordinator.isProgrammaticScrollActive()).toBe(false);
  });
});
