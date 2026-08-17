import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlannerNewSessionToggleButton } from './PlannerNewSessionToggleButton';

describe('PlannerNewSessionToggleButton', () => {
  it('uses fixed icon-only width below sm and full width with padding at sm+', () => {
    render(<PlannerNewSessionToggleButton isActive={false} onToggle={vi.fn()} />);
    const button = screen.getByTestId('planner-new-session-toggle');

    expect(button.className).toContain('w-10');
    expect(button.className).toContain('px-0');
    expect(button.className).toContain('sm:w-full');
    expect(button.className).toContain('sm:px-3');
  });

  it('hides the label below the sm breakpoint', () => {
    render(<PlannerNewSessionToggleButton isActive={false} onToggle={vi.fn()} />);
    const label = screen.getByText('New Session');

    expect(label.className).toContain('hidden');
    expect(label.className).toContain('sm:inline');
  });
});
