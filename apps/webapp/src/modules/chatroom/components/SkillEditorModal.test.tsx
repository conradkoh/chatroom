import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillEditorModal } from './SkillEditorModal';

const mockUpdateCustomization = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockUpdateCustomization,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatroomSkillCustomizations: {
      update: { name: 'update' },
    },
  },
}));

function renderModal() {
  const onClose = vi.fn();
  render(
    <SkillEditorModal
      isOpen
      onClose={onClose}
      chatroomId="room-1"
      customizationId="cust-1"
      initialContent="Be concise."
      skillName="Review"
    />
  );
  return { onClose };
}

describe('SkillEditorModal save', () => {
  beforeEach(() => {
    mockUpdateCustomization.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a save failure inline and keeps the editor open', async () => {
    mockUpdateCustomization.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to save skill customization. Please try again.'
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('Be concise.');
  });

  it('clears the failure when the next save starts', async () => {
    mockUpdateCustomization
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes after a successful save without showing any message', async () => {
    mockUpdateCustomization.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
