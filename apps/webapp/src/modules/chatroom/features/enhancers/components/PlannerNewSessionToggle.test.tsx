import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('requests composer focus on Ctrl+N shortcut but not on button click', () => {
    const onRequestComposerFocus = vi.fn();
    render(
      <StartInNewSessionPreferenceProvider>
        <PlannerNewSessionToggle onRequestComposerFocus={onRequestComposerFocus} />
      </StartInNewSessionPreferenceProvider>
    );

    const button = screen.getByTestId('planner-new-session-toggle');

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', ctrlKey: true, bubbles: true })
      );
    });

    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(onRequestComposerFocus).toHaveBeenCalledTimes(1);

    // Button clicks toggle state without requesting composer focus.
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(onRequestComposerFocus).toHaveBeenCalledTimes(1);
  });
});
