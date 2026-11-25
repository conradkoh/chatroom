import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Imports ───────────────────────────────────────────────────────────────────

import { checkDuplicateName, SavedCommandModal } from './SavedCommandModal';
import type { SavedCommand, SavedCommandScope } from '../types/savedCommand';

// ── Mocks (must be before imports that use them) ─────────────────────────────

const mockCreateSavedCommand = vi.fn();
const mockUpdateSavedCommand = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (mutationRef: unknown) => {
    const ref = mutationRef as { name?: string };
    if (ref && typeof ref === 'object' && 'name' in ref && ref.name === 'updateSavedCommand') {
      return mockUpdateSavedCommand;
    }
    return mockCreateSavedCommand;
  },
  useSessionQuery: () => undefined,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    savedCommands: {
      createSavedCommand: { name: 'createSavedCommand' },
      updateSavedCommand: { name: 'updateSavedCommand' },
    },
  },
}));

// Helper to create a typed SavedCommand for tests without importing Id
const makeCmd = (overrides?: Partial<SavedCommand>): SavedCommand => ({
  _id: 'cmd-abc' as any,
  type: 'prompt',
  scope: 'chatroom',
  name: 'Old Name',
  prompt: 'Old prompt',
  ...overrides,
});

const emptyNamesByScope: Record<SavedCommandScope, string[]> = { user: [], chatroom: [] };

/**
 * Renders the modal and waits for the name input to receive the auto-focus that
 * `SavedCommandModal` schedules 50 ms after mount. Waiting here, rather than only in
 * the tests that happen to type first, means no test can interact with the modal while
 * that timer is still pending and have focus stolen mid-typing (commits 1a68ce91c and
 * 95d38b03f each fixed one instance of that race).
 */
async function renderModal(
  props: Omit<React.ComponentProps<typeof SavedCommandModal>, 'isOpen' | 'chatroomId'>
) {
  const result = render(<SavedCommandModal isOpen={true} chatroomId="room-1" {...props} />);
  await waitFor(() => expect(screen.getByLabelText(/^name$/i)).toHaveFocus());
  return result;
}

// ── Unit Tests: checkDuplicateName (re-exported from utils) ─────────────────

describe('checkDuplicateName', () => {
  it('returns null when no duplicate exists', () => {
    const result = checkDuplicateName('My Command', 'chatroom', {
      user: [],
      chatroom: ['Other Command', 'Another'],
    });
    expect(result).toBeNull();
  });

  it('returns error message when duplicate exists (case-insensitive)', () => {
    const result = checkDuplicateName('my command', 'chatroom', {
      user: [],
      chatroom: ['My Command', 'Another'],
    });
    expect(result).toBe('A command named "my command" already exists in this chatroom scope.');
  });

  it('allows saving same name in edit mode (self-exclusion)', () => {
    const result = checkDuplicateName(
      'My Command',
      'chatroom',
      {
        user: [],
        chatroom: ['My Command', 'Another'],
      },
      { isEditMode: true, initialName: 'My Command', initialScope: 'chatroom' }
    );
    expect(result).toBeNull();
  });

  it('is case-insensitive for self-exclusion in edit mode', () => {
    const result = checkDuplicateName(
      'my command',
      'chatroom',
      {
        user: [],
        chatroom: ['My Command', 'Another'],
      },
      { isEditMode: true, initialName: 'My Command', initialScope: 'chatroom' }
    );
    expect(result).toBeNull();
  });

  it('still catches duplicate in edit mode if different command has same name', () => {
    const result = checkDuplicateName(
      'Other Command',
      'chatroom',
      {
        user: [],
        chatroom: ['My Command', 'Other Command'],
      },
      { isEditMode: true, initialName: 'My Command', initialScope: 'chatroom' }
    );
    expect(result).toBe('A command named "Other Command" already exists in this chatroom scope.');
  });
});

// ── Component Tests: SavedCommandModal ──────────────────────────────────────

describe('SavedCommandModal component', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    mockCreateSavedCommand.mockReset();
    mockUpdateSavedCommand.mockReset();
    mockCreateSavedCommand.mockResolvedValue(undefined);
    mockUpdateSavedCommand.mockResolvedValue(undefined);
  });

  it('calls createSavedCommand with trimmed name + prompt in create mode', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    await renderModal({
      onClose: onClose,
      onCreated: onCreated,
      existingNamesByScope: emptyNamesByScope,
    });

    await user.type(screen.getByLabelText(/^name$/i), 'My Command');
    await user.type(screen.getByLabelText(/^prompt$/i), 'Do something useful');

    await user.click(screen.getByRole('button', { name: /save command/i }));

    await waitFor(() => {
      expect(mockCreateSavedCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: {
            type: 'prompt',
            scope: 'chatroom',
            name: 'My Command',
            prompt: 'Do something useful',
          },
        })
      );
    });
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls updateSavedCommand when initial is provided (edit mode)', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    await renderModal({
      onClose: onClose,
      onCreated: onCreated,
      initial: makeCmd(),
      existingNamesByScope: emptyNamesByScope,
    });

    const nameInput = screen.getByLabelText(/^name$/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'New Name');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateSavedCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          commandId: 'cmd-abc',
          name: 'New Name',
          command: { type: 'prompt', prompt: 'Old prompt' },
        })
      );
    });
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape key closes the modal', async () => {
    const onClose = vi.fn();
    await renderModal({
      onClose: onClose,
      existingNamesByScope: emptyNamesByScope,
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders at Z_FLOATING so it stacks above the command dialog', async () => {
    const { container } = await renderModal({
      onClose: vi.fn(),
      existingNamesByScope: emptyNamesByScope,
    });

    const overlay = container.querySelector('div[class*="z-[100]"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('duplicate name shows inline error and does not call mutation', async () => {
    const onClose = vi.fn();
    await renderModal({
      onClose: onClose,
      existingNamesByScope: { user: [], chatroom: ['Foo'] },
    });

    const nameInput = screen.getByLabelText(/^name$/i);
    const promptInput = screen.getByLabelText(/^prompt$/i);

    // Use change events so this test is not sensitive to focus races from the
    // modal's delayed auto-focus or userEvent state from other parallel tests.
    fireEvent.change(nameInput, { target: { value: 'foo' } });
    fireEvent.change(promptInput, { target: { value: 'some prompt' } });

    const saveButton = screen.getByRole('button', { name: /save command/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    expect(
      await screen.findByText('A command named "foo" already exists in this chatroom scope.')
    ).toBeInTheDocument();
    expect(mockCreateSavedCommand).not.toHaveBeenCalled();
  });

  it('type selector renders "Message Prompt" as the only option', async () => {
    await renderModal({
      onClose: vi.fn(),
      existingNamesByScope: emptyNamesByScope,
    });

    const select = screen.getByLabelText(/^type$/i) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.options).toHaveLength(1);
    expect(select.options[0].text).toBe('Message Prompt');
    expect(select.options[0].value).toBe('prompt');
  });

  it('type selector is disabled in edit mode', async () => {
    await renderModal({
      onClose: vi.fn(),
      initial: makeCmd(),
      existingNamesByScope: emptyNamesByScope,
    });

    const select = screen.getByLabelText(/^type$/i) as HTMLSelectElement;
    expect(select).toBeDisabled();
  });

  // ── Scope Tests ──────────────────────────────────────────────────────────

  it('scope selector shows both options in create mode', async () => {
    await renderModal({
      onClose: vi.fn(),
      existingNamesByScope: emptyNamesByScope,
    });

    const select = screen.getByLabelText(/^scope$/i) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.options).toHaveLength(2);
    expect(select.options[0].text).toBe('User (all chatrooms)');
    expect(select.options[0].value).toBe('user');
    expect(select.options[1].text).toBe('Chatroom only');
    expect(select.options[1].value).toBe('chatroom');
  });

  it('scope selector is enabled in edit mode', async () => {
    await renderModal({
      onClose: vi.fn(),
      initial: makeCmd(),
      existingNamesByScope: emptyNamesByScope,
    });

    const select = screen.getByLabelText(/^scope$/i) as HTMLSelectElement;
    expect(select).not.toBeDisabled();
  });

  it('updateSavedCommand includes scope when changed in edit mode', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    await renderModal({
      onClose: onClose,
      onCreated: onCreated,
      initial: makeCmd({ scope: 'chatroom' }),
      existingNamesByScope: emptyNamesByScope,
    });

    const scopeSelect = screen.getByLabelText(/^scope$/i);
    await user.selectOptions(scopeSelect, 'user');

    const nameInput = screen.getByLabelText(/^name$/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Changed Scope Cmd');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateSavedCommand).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'user' })
      );
    });
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('create payload includes scope when chatroom scope is selected', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    await renderModal({
      onClose: onClose,
      onCreated: onCreated,
      existingNamesByScope: emptyNamesByScope,
    });

    // Use change events so the modal's delayed auto-focus cannot steal focus
    // between typing the name and prompt fields.
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Test Cmd' } });
    fireEvent.change(screen.getByLabelText(/^prompt$/i), { target: { value: 'Test prompt' } });

    await user.click(screen.getByRole('button', { name: /save command/i }));

    await waitFor(() => {
      expect(mockCreateSavedCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.objectContaining({ scope: 'chatroom' }),
        })
      );
    });
  });

  it('create payload includes scope when user scope is selected', async () => {
    const onClose = vi.fn();
    await renderModal({
      onClose: onClose,
      existingNamesByScope: emptyNamesByScope,
    });

    const scopeSelect = screen.getByLabelText(/^scope$/i);
    await user.selectOptions(scopeSelect, 'user');

    await user.type(screen.getByLabelText(/^name$/i), 'My User Cmd');
    await user.type(screen.getByLabelText(/^prompt$/i), 'User prompt');

    await user.click(screen.getByRole('button', { name: /save command/i }));

    await waitFor(() => {
      expect(mockCreateSavedCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.objectContaining({ scope: 'user' }),
        })
      );
    });
  });

  it('renders scope hint text when scope is selected', async () => {
    await renderModal({
      onClose: vi.fn(),
      existingNamesByScope: emptyNamesByScope,
    });

    expect(screen.getByText('Available only in this chatroom.')).toBeInTheDocument();
  });

  it('opens with defaultScope="user" pre-selects user scope', async () => {
    const onClose = vi.fn();
    await renderModal({
      onClose: onClose,
      existingNamesByScope: emptyNamesByScope,
      defaultScope: 'user',
    });

    const scopeSelect = screen.getByLabelText(/^scope$/i) as HTMLSelectElement;
    expect(scopeSelect.value).toBe('user');
  });

  it('shows a failed save inline and keeps the modal open', async () => {
    mockCreateSavedCommand.mockRejectedValue(new Error('network down'));
    const onClose = vi.fn();
    await renderModal({
      onClose: onClose,
      existingNamesByScope: emptyNamesByScope,
    });
    await user.type(screen.getByLabelText(/^name$/i), 'My Command');
    await user.type(screen.getByLabelText(/^prompt$/i), 'Do something useful');

    await user.click(screen.getByRole('button', { name: /save command/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to save command. Please try again.'
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the server duplicate-name copy inline', async () => {
    mockCreateSavedCommand.mockRejectedValue(new Error('COMMAND_NAME_DUPLICATE'));
    await renderModal({
      onClose: vi.fn(),
      existingNamesByScope: emptyNamesByScope,
    });
    await user.type(screen.getByLabelText(/^name$/i), 'My Command');
    await user.type(screen.getByLabelText(/^prompt$/i), 'Do something useful');

    await user.click(screen.getByRole('button', { name: /save command/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A command with that name already exists in this scope.'
    );
  });

  it('clears a failed save when the next submit starts', async () => {
    mockCreateSavedCommand
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    await renderModal({
      onClose: onClose,
      existingNamesByScope: emptyNamesByScope,
    });
    await user.type(screen.getByLabelText(/^name$/i), 'My Command');
    await user.type(screen.getByLabelText(/^prompt$/i), 'Do something useful');
    await user.click(screen.getByRole('button', { name: /save command/i }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: /save command/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes after a successful create without showing any message', async () => {
    const onClose = vi.fn();
    await renderModal({
      onClose: onClose,
      existingNamesByScope: emptyNamesByScope,
    });
    await user.type(screen.getByLabelText(/^name$/i), 'My Command');
    await user.type(screen.getByLabelText(/^prompt$/i), 'Do something useful');

    await user.click(screen.getByRole('button', { name: /save command/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
