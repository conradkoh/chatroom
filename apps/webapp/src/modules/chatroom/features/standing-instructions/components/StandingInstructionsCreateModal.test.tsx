import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StandingInstructionsCreateModal } from './StandingInstructionsCreateModal';

const mockUseIsDesktop = vi.fn(() => true);
const mockKeyboardInset = vi.fn(() => 0);

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

vi.mock('@/hooks/useMobileKeyboard', () => ({
  useVisualViewportKeyboardInset: () => mockKeyboardInset(),
}));

describe('StandingInstructionsCreateModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsDesktop.mockReturnValue(true);
    mockKeyboardInset.mockReturnValue(0);
  });

  it('renders dialog with title Create standing instruction', () => {
    render(<StandingInstructionsCreateModal open onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Create standing instruction')).toBeInTheDocument();
  });

  it('disables Confirm until both title and content are filled', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsCreateModal open onOpenChange={vi.fn()} onConfirm={vi.fn()} />);

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Enter standing instructions…'), 'rule body');
    expect(confirmBtn).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Title'), 'My rule');
    expect(confirmBtn).not.toBeDisabled();
  });

  it('calls onConfirm with trimmed payload and closes modal', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <StandingInstructionsCreateModal open onOpenChange={onOpenChange} onConfirm={onConfirm} />
    );

    await user.type(screen.getByPlaceholderText('Enter standing instructions…'), '  rule body  ');
    await user.type(screen.getByPlaceholderText('Title'), '  My rule  ');
    await user.click(screen.getByText('Confirm'));

    expect(onConfirm).toHaveBeenCalledWith({ content: 'rule body', title: 'My rule' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Cancel closes without calling onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <StandingInstructionsCreateModal open onOpenChange={onOpenChange} onConfirm={onConfirm} />
    );

    await user.type(screen.getByPlaceholderText('Enter standing instructions…'), 'rule body');
    await user.click(screen.getByText('Cancel'));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Ctrl+Enter confirms when both fields are filled', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<StandingInstructionsCreateModal open onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    const textarea = screen.getByPlaceholderText('Enter standing instructions…');
    await user.type(textarea, 'updated instruction');
    await user.type(screen.getByPlaceholderText('Title'), 'Update rule');
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(onConfirm).toHaveBeenCalledWith({
      content: 'updated instruction',
      title: 'Update rule',
    });
  });

  it('Confirm button uses industrial primary styling', () => {
    render(<StandingInstructionsCreateModal open onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('bg-chatroom-accent');
    expect(confirmBtn.className).toContain('text-chatroom-bg-primary');
  });
});
