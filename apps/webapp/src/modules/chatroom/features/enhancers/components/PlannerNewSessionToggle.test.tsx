import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PlannerNewSessionToggle } from './PlannerNewSessionToggle';
import { StartInNewSessionPreferenceProvider } from '../../../hooks/useStartInNewSessionPreference';

function mockPlatform(platform: string) {
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: platform,
  });
}

describe('PlannerNewSessionToggle', () => {
  beforeEach(() => {
    mockPlatform('MacIntel');
  });

  it('toggles state with Ctrl+N on macOS', () => {
    render(
      <StartInNewSessionPreferenceProvider>
        <PlannerNewSessionToggle />
      </StartInNewSessionPreferenceProvider>
    );

    const button = screen.getByTestId('planner-new-session-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'false');

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', ctrlKey: true, bubbles: true })
      );
    });

    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});
