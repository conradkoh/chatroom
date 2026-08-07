import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnhancerActivityBarItem } from './EnhancerActivityBarItem';

const mockOpenDialog = vi.fn();
let mockIsActive = false;

vi.mock('../hooks/useEnhancerConfigDialogHost', () => ({
  useEnhancerConfigDialogHost: () => ({
    openDialog: mockOpenDialog,
    dialog: null,
    isActive: mockIsActive,
  }),
}));

describe('EnhancerActivityBarItem', () => {
  beforeEach(() => {
    mockIsActive = false;
    mockOpenDialog.mockReset();
  });

  it('renders the sparkles button', () => {
    render(<EnhancerActivityBarItem chatroomId="room-1" machineId={null} />);

    expect(screen.getByTestId('enhancer-activity-bar-item')).toBeInTheDocument();
  });

  it('shows inactive styling by default', () => {
    render(<EnhancerActivityBarItem chatroomId="room-1" machineId={null} />);

    const button = screen.getByTestId('enhancer-activity-bar-item');
    expect(button).not.toHaveAttribute('aria-pressed');
    expect(button).toHaveAttribute('title', 'Configure planning review');
    expect(button).toHaveAttribute('aria-label', 'Configure planning review');
    expect(button.className).toContain('text-chatroom-text-muted');
  });

  it('does not show active state when enhancer config is enabled', () => {
    mockIsActive = true;

    render(<EnhancerActivityBarItem chatroomId="room-1" machineId={null} />);

    const button = screen.getByTestId('enhancer-activity-bar-item');
    expect(button).not.toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('title', 'Configure planning review');
    expect(button).toHaveAttribute('aria-label', 'Configure planning review');
    expect(button.className).toContain('text-chatroom-text-muted');
    expect(button.querySelector('.bg-chatroom-accent')).toBeNull();
  });

  it('opens the config dialog on click', () => {
    render(<EnhancerActivityBarItem chatroomId="room-1" machineId={null} />);

    fireEvent.click(screen.getByTestId('enhancer-activity-bar-item'));

    expect(mockOpenDialog).toHaveBeenCalledOnce();
  });
});
