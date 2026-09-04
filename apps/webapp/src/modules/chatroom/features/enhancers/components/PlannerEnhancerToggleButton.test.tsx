import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlannerEnhancerToggleButton } from './PlannerEnhancerToggleButton';

describe('PlannerEnhancerToggleButton', () => {
  it('uses fixed icon-only width below sm and full width with padding at sm+', () => {
    render(
      <PlannerEnhancerToggleButton
        isActive={false}
        isDisabling={false}
        teamSupportState="supported"
        onToggle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );
    const button = screen.getByTestId('planner-enhancer-toggle');

    expect(button.className).toContain('w-[3.75rem]');
    expect(button.className).toContain('px-0');
    expect(button.className).toContain('sm:w-full');
    expect(button.className).toContain('sm:px-3');
  });

  it('keeps active preference styling static without pulsing', () => {
    render(
      <PlannerEnhancerToggleButton
        isActive
        isDisabling={false}
        teamSupportState="supported"
        onToggle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );

    const button = screen.getByTestId('planner-enhancer-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.className).toContain('text-blue-500');
    expect(button.className).toContain('dark:text-blue-400');
    expect(button.className).toContain('bg-blue-500/10');
    expect(button.className).not.toContain('animate-pulse');
  });
});
