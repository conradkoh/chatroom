/**
 * Regression test: `ref={virtualizer.measureElement}` MUST be passed directly,
 * not wrapped in an inline arrow.
 *
 * An inline arrow creates a new function identity every render, causing React
 * to call cleanup(null) then measureElement again on the DOM node. When
 * estimateSize uses a running average that drifts during measurement, each
 * measureElement call triggers a setState (because the estimated size differs
 * from the new measured size), which re-renders, which creates a new inline
 * ref identity, and the loop never converges → "Maximum update depth exceeded".
 *
 * This test verifies the structural contract: direct ref doesn't crash.
 * Reproducing the bug fully requires a real browser (jsdom lacks layout for
 * getBoundingClientRect, so virtualizer measurements never change). The BAD
 * variant is documented as a manual verification case below.
 */

import React, { useRef, useEffect } from 'react';

import { useVirtualizer } from '@tanstack/react-virtual';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Error boundary ─────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div data-testid="error-boundary">{this.state.error.message}</div>;
    }
    return this.props.children;
  }
}

// ─── Test component — same estimateSize-from-running-average pattern as MessageFeed ──

function VirtualList({ items }: { items: { _id: string; content: string }[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const measuredSizesByIdRef = useRef<Map<string, number>>(new Map());

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => {
      const sizes = Array.from(measuredSizesByIdRef.current.values());
      if (sizes.length === 0) return 80;
      return sizes.reduce((a, b) => a + b, 0) / sizes.length;
    },
    overscan: 2,
    getItemKey: (index) => items[index]._id,
  });

  // Sample measured sizes in a useEffect — NOT inside the measureElement ref.
  // This avoids setState as a side effect of measureElement.
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    for (const item of virtualItems) {
      const id = items[item.index]?._id;
      if (!id) continue;
      const size = item.size;
      if (size <= 0) continue;
      const prev = measuredSizesByIdRef.current.get(id);
      if (prev !== size) {
        measuredSizesByIdRef.current.set(id, size);
        if (measuredSizesByIdRef.current.size > 50) {
          const firstKey = measuredSizesByIdRef.current.keys().next().value;
          if (firstKey !== undefined) measuredSizesByIdRef.current.delete(firstKey);
        }
      }
    }
  }, [virtualItems, items]);

  return (
    <div ref={scrollRef} style={{ height: 400, overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {/* MUST be virtualizer.measureElement directly — no inline wrappers */}
        {virtualizer.getVirtualItems().map((vItem) => (
          <div
            key={vItem.key}
            ref={virtualizer.measureElement}
            data-index={vItem.index}
            data-testid={`row-${vItem.index}`}
            style={{
              position: 'absolute',
              top: 0,
              transform: `translateY(${vItem.start}px)`,
            }}
          >
            {items[vItem.index].content}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    _id: `msg-${i}`,
    content: `Message ${i}: lorem ipsum dolor sit amet`,
  }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VirtualizerRefStability — infinite re-render regression', () => {
  let consoleErrorSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('direct ref={virtualizer.measureElement} does NOT trigger max-update-depth', () => {
    const items = generateItems(100);

    render(
      <ErrorBoundary>
        <VirtualList items={items} />
      </ErrorBoundary>
    );

    const maxUpdateErrors = consoleErrorSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('Maximum update depth')
    );
    expect(maxUpdateErrors).toHaveLength(0);
  });

  // Documented as a manual test because jsdom lacks real layout:
  //
  // To manually verify the BAD case (inline ref causes infinite loop):
  // 1. Change ref={virtualizer.measureElement} to ref={(node) => { virtualizer.measureElement(node) }}
  // 2. Open a chatroom with 200+ messages in the browser
  // 3. Scroll rapidly — observe "Maximum update depth exceeded" in console
  //
  // The loop requires: (a) real DOM measurements via getBoundingClientRect,
  // (b) estimateSize that drifts between renders, and (c) inline ref identity
  // changing every render. Jsdom can't satisfy (a).
  it.todo(
    'BAD: inline ref wrapping measureElement triggers max-update-depth (manual verification only — needs browser layout)'
  );
});
