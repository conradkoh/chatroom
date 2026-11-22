import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StandingInstructionsEditModal } from './StandingInstructionsEditModal';

const mockUseIsDesktop = vi.fn(() => true);

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

vi.mock('@/hooks/useMobileKeyboard', () => ({
  useVisualViewportKeyboardInset: () => 0,
  useVisualViewportOffsetTop: () => 0,
}));

describe('StandingInstructionsEditModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsDesktop.mockReturnValue(true);
  });

  it('pre-fills from initial title and content', () => {
    render(
      <StandingInstructionsEditModal
        open
        onOpenChange={vi.fn()}
        initialTitle="My rule"
        initialContent="Rule body"
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText('Title')).toHaveValue('My rule');
    expect(screen.getByPlaceholderText('Enter standing instructions…')).toHaveValue('Rule body');
  });

  it('calls onConfirm with trimmed payload on confirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <StandingInstructionsEditModal
        open
        onOpenChange={vi.fn()}
        initialTitle="My rule"
        initialContent="Rule body"
        onConfirm={onConfirm}
      />
    );

    const titleInput = screen.getByPlaceholderText('Title');
    await user.clear(titleInput);
    await user.type(titleInput, '  Updated  ');

    const contentInput = screen.getByPlaceholderText('Enter standing instructions…');
    await user.clear(contentInput);
    await user.type(contentInput, '  New body  ');

    await user.click(screen.getByText('Confirm'));

    expect(onConfirm).toHaveBeenCalledWith({ content: 'New body', title: 'Updated' });
  });

  it('re-seeds drafts when open transitions with new initial values', () => {
    const { rerender } = render(
      <StandingInstructionsEditModal
        open={false}
        onOpenChange={vi.fn()}
        initialTitle="First"
        initialContent="First body"
        onConfirm={vi.fn()}
      />
    );

    rerender(
      <StandingInstructionsEditModal
        open
        onOpenChange={vi.fn()}
        initialTitle="Second"
        initialContent="Second body"
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByPlaceholderText('Title')).toHaveValue('Second');
    expect(screen.getByPlaceholderText('Enter standing instructions…')).toHaveValue('Second body');
  });

  it('saves with Cmd+Enter from the textarea', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <StandingInstructionsEditModal
        open
        onOpenChange={vi.fn()}
        initialTitle="My rule"
        initialContent="Rule body"
        onConfirm={onConfirm}
      />
    );

    const contentInput = screen.getByPlaceholderText('Enter standing instructions…');
    await user.click(contentInput);
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(onConfirm).toHaveBeenCalledWith({ content: 'Rule body', title: 'My rule' });
  });

  it('saves with Cmd+Enter from the title input', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <StandingInstructionsEditModal
        open
        onOpenChange={vi.fn()}
        initialTitle="My rule"
        initialContent="Rule body"
        onConfirm={onConfirm}
      />
    );

    const titleInput = screen.getByPlaceholderText('Title');
    await user.click(titleInput);
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(onConfirm).toHaveBeenCalledWith({ content: 'Rule body', title: 'My rule' });
  });

  it('keeps the dialog open and shows the conflict inline when save fails', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error('CONFLICT: already exists'));
    render(
      <StandingInstructionsEditModal
        open
        onOpenChange={vi.fn()}
        initialTitle="My rule"
        initialContent="Rule body"
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByText('Confirm'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another standing instruction with this content already exists.'
    );
    expect(screen.getByText('Edit standing instruction')).toBeInTheDocument();
  });

  it('shows the fallback copy inline when save fails with another error', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error('network down'));
    render(
      <StandingInstructionsEditModal
        open
        onOpenChange={vi.fn()}
        initialTitle="My rule"
        initialContent="Rule body"
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByText('Confirm'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to update standing instruction. Please try again.'
    );
  });

  it('clears the save failure when the next save attempt starts', async () => {
    const user = userEvent.setup();
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockReturnValueOnce(new Promise(() => {}));
    render(
      <StandingInstructionsEditModal
        open
        onOpenChange={vi.fn()}
        initialTitle="My rule"
        initialContent="Rule body"
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByText('Confirm'));
    await screen.findByRole('alert');

    await user.click(screen.getByText('Confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
