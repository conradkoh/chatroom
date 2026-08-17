import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlannerEnhancerToggleButton } from './PlannerEnhancerToggleButton';

describe('PlannerEnhancerToggleButton', () => {
  it('uses fixed icon-only width below sm and full width with padding at sm+', () => {
    render(
      <PlannerEnhancerToggleButton
        isActive={false}
        isEnhancing={false}
        isDisabling={false}
        teamSupportState="supported"
        onToggle={vi.fn()}
        onConfigure={vi.fn()}
        onUnsupportedClick={vi.fn()}
      />
    );
    const button = screen.getByTestId('planner-enhancer-toggle');

    expect(button.className).toContain('w-10');
    expect(button.className).toContain('px-0');
    expect(button.className).toContain('sm:w-full');
    expect(button.className).toContain('sm:px-3');
  });
});
