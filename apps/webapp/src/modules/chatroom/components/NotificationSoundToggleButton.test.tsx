import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationSoundToggleButton } from './NotificationSoundToggleButton';

const SETTINGS_KEY = 'chatroom:notification-sound-settings';

vi.mock('../utils/playNotificationSound', () => ({
  playNotificationSound: vi.fn(),
}));

import { playNotificationSound } from '../utils/playNotificationSound';

describe('NotificationSoundToggleButton', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(playNotificationSound).mockClear();
  });

  it('shows Volume2 icon when unmuted', () => {
    render(<NotificationSoundToggleButton />);
    expect(document.querySelector('.lucide-volume2')).not.toBeNull();
    expect(document.querySelector('.lucide-volume-x')).toBeNull();
  });

  it('shows VolumeX icon when muted', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ muted: true }));
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
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.muted).toBe(true);

    await user.click(screen.getByRole('button'));
    expect(document.querySelector('.lucide-volume2')).not.toBeNull();
    const stored2 = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored2.muted).toBe(false);
  });

  it('has aria-pressed attribute reflecting muted state', () => {
    const { rerender } = render(<NotificationSoundToggleButton />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');

    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ muted: true }));
    rerender(<NotificationSoundToggleButton key="muted" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows Play test sound in context menu on right-click', () => {
    render(<NotificationSoundToggleButton />);
    fireEvent.contextMenu(screen.getByTestId('notification-sound-toggle'));
    expect(screen.getByTestId('notification-sound-play-test')).toHaveTextContent('Play test sound');
  });

  it('shows Sound settings in context menu on right-click', () => {
    render(<NotificationSoundToggleButton />);
    fireEvent.contextMenu(screen.getByTestId('notification-sound-toggle'));
    expect(screen.getByTestId('notification-sound-open-settings')).toHaveTextContent(
      'Sound settings'
    );
  });

  it('opens settings dialog when Sound settings is selected', async () => {
    const user = userEvent.setup();
    render(<NotificationSoundToggleButton />);
    fireEvent.contextMenu(screen.getByTestId('notification-sound-toggle'));
    await user.click(screen.getByTestId('notification-sound-open-settings'));
    expect(screen.getByTestId('notification-sound-settings-dialog')).toBeInTheDocument();
  });

  it('calls playNotificationSound with force on Play test sound select', async () => {
    const user = userEvent.setup();
    render(<NotificationSoundToggleButton />);
    fireEvent.contextMenu(screen.getByTestId('notification-sound-toggle'));
    await user.click(screen.getByTestId('notification-sound-play-test'));
    expect(playNotificationSound).toHaveBeenCalledWith({ force: true });
  });
});
