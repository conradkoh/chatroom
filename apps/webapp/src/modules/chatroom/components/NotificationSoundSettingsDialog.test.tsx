import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationSoundSettingsDialog } from './NotificationSoundSettingsDialog';

vi.mock('../utils/playNotificationSound', () => ({
  playNotificationSound: vi.fn(),
}));

import { playNotificationSound } from '../utils/playNotificationSound';

const SETTINGS_KEY = 'chatroom:notification-sound-settings';

describe('NotificationSoundSettingsDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(playNotificationSound).mockClear();
  });

  it('renders dialog content when open', () => {
    render(<NotificationSoundSettingsDialog open={true} onOpenChange={() => {}} />);
    expect(screen.getByTestId('notification-sound-settings-dialog')).toBeInTheDocument();
    expect(screen.getByText('Notification sound')).toBeInTheDocument();
  });

  it('shows profile options', () => {
    render(<NotificationSoundSettingsDialog open={true} onOpenChange={() => {}} />);
    expect(screen.getByTestId('notification-sound-profile-subtle')).toBeInTheDocument();
    expect(screen.getByTestId('notification-sound-profile-standard')).toBeInTheDocument();
    expect(screen.getByTestId('notification-sound-profile-urgent')).toBeInTheDocument();
  });

  it('selecting urgent profile persists it', () => {
    render(<NotificationSoundSettingsDialog open={true} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByTestId('notification-sound-profile-urgent'));
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.profile).toBe('urgent');
  });

  it('volume slider persists settings', () => {
    render(<NotificationSoundSettingsDialog open={true} onOpenChange={() => {}} />);
    const slider = screen.getByTestId('notification-sound-volume-slider');
    fireEvent.change(slider, { target: { value: '50' } });
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.volume).toBe(0.5);
  });

  it('hydrates profile and volume from localStorage without showing defaults', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ muted: false, profile: 'urgent', volume: 0.4 })
    );
    render(<NotificationSoundSettingsDialog open={true} onOpenChange={() => {}} />);
    const urgentRadio = screen.getByRole('radio', { name: /urgent/i });
    expect(urgentRadio).toBeChecked();
    expect(screen.getByText('Volume: 40%')).toBeInTheDocument();
  });

  it('Play test sound button calls playNotificationSound with force and preview', () => {
    render(<NotificationSoundSettingsDialog open={true} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByTestId('notification-sound-settings-play-test'));
    expect(playNotificationSound).toHaveBeenCalledWith({
      force: true,
      preview: { profile: 'standard', volume: 0.75 },
    });
  });
});
