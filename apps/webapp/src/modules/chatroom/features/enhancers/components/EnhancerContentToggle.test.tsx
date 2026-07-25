import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnhancerContentToggle } from './EnhancerContentToggle';

describe('EnhancerContentToggle', () => {
  it('renders button with aria-pressed=false when showOriginal=false', () => {
    render(<EnhancerContentToggle showOriginal={false} onToggle={vi.fn()} />);

    const button = screen.getByTestId('enhancer-content-toggle');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('title', 'Show original version');
  });

  it('renders button with aria-pressed=true when showOriginal=true', () => {
    render(<EnhancerContentToggle showOriginal={true} onToggle={vi.fn()} />);

    const button = screen.getByTestId('enhancer-content-toggle');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('title', 'Show enhanced version');
  });

  it('calls onToggle on click', () => {
    const onToggle = vi.fn();
    render(<EnhancerContentToggle showOriginal={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByTestId('enhancer-content-toggle'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
