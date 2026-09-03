import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlannerNewSessionToggle } from './PlannerNewSessionToggle';
import { StartInNewSessionPreferenceProvider } from '../../../hooks/useStartInNewSessionPreference';

describe('PlannerNewSessionToggle', () => {
  it('toggles state with Alt+N', () => {
    render(
      <StartInNewSessionPreferenceProvider>
        <PlannerNewSessionToggle />
      </StartInNewSessionPreferenceProvider>
    );

    const button = screen.getByTestId('planner-new-session-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'false');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', altKey: true, bubbles: true }));
    });

    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});
