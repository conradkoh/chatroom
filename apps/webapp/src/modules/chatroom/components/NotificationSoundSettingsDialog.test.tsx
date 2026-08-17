import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationSoundSettingsDialog } from './NotificationSoundSettingsDialog';
import { playNotificationSound } from '../utils/playNotificationSound';

vi.mock('../utils/playNotificationSound', () => ({
  playNotificationSound: vi.fn(),
}));

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
    expect(screen.getByTestId('notification-sound-profile-bright')).toBeInTheDocument();
    expect(screen.getByTestId('notification-sound-profile-alarm')).toBeInTheDocument();
  });

  it('selecting urgent profile persists immediately', () => {
    render(<NotificationSoundSettingsDialog open={true} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByTestId('notification-sound-profile-urgent'));
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).profile).toBe('urgent');
  });

  it('volume slider persists immediately', () => {
    render(<NotificationSoundSettingsDialog open={true} onOpenChange={() => {}} />);
    const slider = screen.getByTestId('notification-sound-volume-slider');
    fireEvent.change(slider, { target: { value: '50' } });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).volume).toBe(0.5);
  });

  it('reset restores default profile and volume', () => {
    render(<NotificationSoundSettingsDialog open={true} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByTestId('notification-sound-profile-urgent'));
    const slider = screen.getByTestId('notification-sound-volume-slider');
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('notification-sound-settings-reset'));
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.profile).toBe('standard');
    expect(stored.volume).toBe(0.75);
  });

  it('profile change plays preview sound with new profile', () => {
    render(<NotificationSoundSettingsDialog open={true} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByTestId('notification-sound-profile-urgent'));
    expect(playNotificationSound).toHaveBeenCalledWith({
      force: true,
      preview: { profile: 'urgent', volume: 0.75 },
    });
  });

  it('volume slider change plays preview sound with updated volume', () => {
    render(<NotificationSoundSettingsDialog open={true} onOpenChange={() => {}} />);
    const slider = screen.getByTestId('notification-sound-volume-slider');
    fireEvent.change(slider, { target: { value: '30' } });
    expect(playNotificationSound).toHaveBeenCalledWith({
      force: true,
      preview: { profile: 'standard', volume: 0.3 },
    });
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
});
