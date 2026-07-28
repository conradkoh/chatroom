import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { NotificationSoundToggleButton } from './NotificationSoundToggleButton';

const STORAGE_KEY = 'chatroom:notification-sound-muted';

describe('NotificationSoundToggleButton', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows Volume2 icon when unmuted', () => {
    render(<NotificationSoundToggleButton />);
    expect(document.querySelector('.lucide-volume2')).not.toBeNull();
    expect(document.querySelector('.lucide-volume-x')).toBeNull();
  });

  it('shows VolumeX icon when muted', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    render(<NotificationSoundToggleButton />);
    expect(document.querySelector('.lucide-volume-x')).not.toBeNull();
    expect(document.querySelector('.lucide-volume2')).toBeNull();
  });

  it('toggles muted state on click and persists', async () => {
    const user = userEvent.setup();
    render(<NotificationSoundToggleButton />);

    expect(document.querySelector('.lucide-volume2')).not.toBeNull();

    await user.click(screen.getByRole('button'));
    expect(document.querySelector('.lucide-volume-x')).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');

    await user.click(screen.getByRole('button'));
    expect(document.querySelector('.lucide-volume2')).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('has aria-pressed attribute reflecting muted state', () => {
    const { rerender } = render(<NotificationSoundToggleButton />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');

    localStorage.setItem(STORAGE_KEY, 'true');
    rerender(<NotificationSoundToggleButton key="muted" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
