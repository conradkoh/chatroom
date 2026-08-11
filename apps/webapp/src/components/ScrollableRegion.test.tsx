import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ScrollableRegion } from './ScrollableRegion';

vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
}));

describe('ScrollableRegion', () => {
  it('renders children with className and data-scroll-region', () => {
    render(
      <ScrollableRegion className="overflow-y-auto test-region">
        <p>Scrollable content</p>
      </ScrollableRegion>
    );

    const region = screen.getByText('Scrollable content').parentElement;
    expect(region).toHaveAttribute('data-scroll-region');
    expect(region).toHaveClass('overflow-y-auto', 'test-region');
  });
});
