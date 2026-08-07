import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Separator } from './separator';

describe('Separator', () => {
  it('renders horizontal separator by default', () => {
    const { container } = render(<Separator />);
    const separator = container.querySelector('[data-slot="separator"]');
    expect(separator).toBeInTheDocument();
  });

  it('renders vertical separator', () => {
    const { container } = render(<Separator orientation="vertical" />);
    const separator = container.querySelector('[data-slot="separator"]');
    expect(separator).toBeInTheDocument();
  });

  it('applies horizontal orientation size classes', () => {
    const { container } = render(<Separator />);
    const separator = container.querySelector('[data-slot="separator"]');
    expect(separator).toHaveAttribute('data-orientation', 'horizontal');
    expect(separator?.className).toContain('data-[orientation=horizontal]:h-px');
    expect(separator?.className).toContain('data-[orientation=horizontal]:w-full');
  });

  it('applies vertical orientation size classes', () => {
    const { container } = render(<Separator orientation="vertical" />);
    const separator = container.querySelector('[data-slot="separator"]');
    expect(separator).toHaveAttribute('data-orientation', 'vertical');
    expect(separator?.className).toContain('data-[orientation=vertical]:w-px');
    expect(separator?.className).toContain('data-[orientation=vertical]:self-stretch');
  });
});
