import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { HarnessAgentSelect } from './HarnessAgentSelect';
import { CAPABILITIES_REFRESH_HINT } from './select-empty-states';

describe('HarnessAgentSelect', () => {
  it('shows the resolved default agent when no agents are available yet', () => {
    render(
      <HarnessAgentSelect agents={[]} value="" onValueChange={vi.fn()} resolvedAgent="builder" />
    );

    expect(screen.getByRole('combobox')).toHaveTextContent('builder (default)');
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveAttribute('title', CAPABILITIES_REFRESH_HINT);
  });

  it('renders eligible agents when available', () => {
    render(
      <HarnessAgentSelect
        agents={[
          { name: 'builder', mode: 'primary' },
          { name: 'reviewer', mode: 'subagent' },
          { name: 'planner', mode: 'all' },
        ]}
        value="builder"
        onValueChange={vi.fn()}
        resolvedAgent="builder"
      />
    );

    expect(screen.getByRole('combobox')).toHaveTextContent('builder');
    expect(screen.getByRole('combobox')).not.toBeDisabled();
  });
});
