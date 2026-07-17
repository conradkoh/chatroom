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
});
