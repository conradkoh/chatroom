import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VirtualizedScrollList } from './VirtualizedScrollList';

describe('VirtualizedScrollList', () => {
  it('renders items via virtualizer', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    const { container } = render(
      <VirtualizedScrollList
        items={items}
        height={200}
        estimateSize={() => 50}
        getItemKey={(_, item) => item.id}
        renderItem={(item) => <div data-testid={`item-${item.id}`}>{item.id}</div>}
      />
    );
    const scrollContainer = container.querySelector('.overflow-y-auto');
    expect(scrollContainer).toBeInTheDocument();
    expect(scrollContainer).toHaveStyle('height: 200px');
  });

  it('does not throw when scrollToItemKey is not in items (retry on items change)', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    const { container, rerender } = render(
      <VirtualizedScrollList
        items={items}
        height={200}
        estimateSize={() => 50}
        getItemKey={(_, item) => item.id}
        renderItem={(item) => <div>{item.id}</div>}
        scrollToItemKey="missing"
      />
    );
    const scrollContainer = container.querySelector('.overflow-y-auto');
    expect(scrollContainer).toBeInTheDocument();

    // Rerender with the target now present — should find it and scroll
    const itemsWithTarget = [{ id: 'a' }, { id: 'b' }, { id: 'missing' }];
    rerender(
      <VirtualizedScrollList
        items={itemsWithTarget}
        height={200}
        estimateSize={() => 50}
        getItemKey={(_, item) => item.id}
        renderItem={(item) => <div>{item.id}</div>}
        scrollToItemKey="missing"
      />
    );
    expect(container.querySelector('.overflow-y-auto')).toBeInTheDocument();
  });

  it('accepts scrollToItemKey prop', () => {
    const items = [{ id: 'target' }, { id: 'other' }];
    const { container } = render(
      <VirtualizedScrollList
        items={items}
        height={200}
        estimateSize={() => 50}
        getItemKey={(_, item) => item.id}
        renderItem={(item) => <div>{item.id}</div>}
        scrollToItemKey="target"
      />
    );
    const scrollContainer = container.querySelector('.overflow-y-auto');
    expect(scrollContainer).toBeInTheDocument();
  });

  it('resets scrollTop when scrollResetKey changes', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    const { container, rerender } = render(
      <VirtualizedScrollList
        items={items}
        height={200}
        estimateSize={() => 50}
        getItemKey={(_, item) => item.id}
        renderItem={(item) => <div>{item.id}</div>}
        scrollResetKey="initial"
      />
    );
    const scrollContainer = container.querySelector('.overflow-y-auto') as HTMLDivElement;
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 100, writable: true });
    expect(scrollContainer.scrollTop).toBe(100);

    rerender(
      <VirtualizedScrollList
        items={items}
        height={200}
        estimateSize={() => 50}
        getItemKey={(_, item) => item.id}
        renderItem={(item) => <div>{item.id}</div>}
        scrollResetKey="changed"
      />
    );
    expect(scrollContainer.scrollTop).toBe(0);
  });
});
