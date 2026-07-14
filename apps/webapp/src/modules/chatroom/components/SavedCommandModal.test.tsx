import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Imports ───────────────────────────────────────────────────────────────────

import { checkDuplicateName, SavedCommandModal } from './SavedCommandModal';
import type { SavedCommand } from '../types/savedCommand';
import type { SavedCommandScope } from '../types/savedCommand';

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
    render(
      <SavedCommandModal
        isOpen={true}
        chatroomId="room-1"
        onClose={onClose}
        onCreated={onCreated}
        existingNamesByScope={emptyNamesByScope}
      />
    );

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
    render(
      <SavedCommandModal
        isOpen={true}
        chatroomId="room-1"
        onClose={onClose}
        onCreated={onCreated}
        initial={makeCmd()}
        existingNamesByScope={emptyNamesByScope}
      />
    );

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

  it('Escape key closes the modal', () => {
    const onClose = vi.fn();
    render(
      <SavedCommandModal
        isOpen={true}
        chatroomId="room-1"
        onClose={onClose}
        existingNamesByScope={emptyNamesByScope}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('duplicate name shows inline error and does not call mutation', async () => {
    const onClose = vi.fn();
    render(
      <SavedCommandModal
        isOpen={true}
        chatroomId="room-1"
        onClose={onClose}
        existingNamesByScope={{ user: [], chatroom: ['Foo'] }}
      />
    );

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

  it('type selector renders "Message Prompt" as the only option', () => {
    render(
      <SavedCommandModal
        isOpen={true}
        chatroomId="room-1"
        onClose={vi.fn()}
        existingNamesByScope={emptyNamesByScope}
      />
    );

    const select = screen.getByLabelText(/^type$/i) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.options).toHaveLength(1);
    expect(select.options[0].text).toBe('Message Prompt');
    expect(select.options[0].value).toBe('prompt');
  });

  it('type selector is disabled in edit mode', () => {
    render(
      <SavedCommandModal
        isOpen={true}
        chatroomId="room-1"
        onClose={vi.fn()}
        initial={makeCmd()}
        existingNamesByScope={emptyNamesByScope}
      />
    );

    const select = screen.getByLabelText(/^type$/i) as HTMLSelectElement;
    expect(select).toBeDisabled();
  });

  // ── Scope Tests ──────────────────────────────────────────────────────────

  it('scope selector shows both options in create mode', () => {
    render(
      <SavedCommandModal
        isOpen={true}
        chatroomId="room-1"
        onClose={vi.fn()}
        existingNamesByScope={emptyNamesByScope}
      />
    );

    const select = screen.getByLabelText(/^scope$/i) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.options).toHaveLength(2);
    expect(select.options[0].text).toBe('User (all chatrooms)');
    expect(select.options[0].value).toBe('user');
    expect(select.options[1].text).toBe('Chatroom only');
    expect(select.options[1].value).toBe('chatroom');
  });

  it('scope selector is disabled in edit mode', () => {
    render(
      <SavedCommandModal
        isOpen={true}
        chatroomId="room-1"
        onClose={vi.fn()}
        initial={makeCmd()}
        existingNamesByScope={emptyNamesByScope}
      />
    );

    const select = screen.getByLabelText(/^scope$/i) as HTMLSelectElement;
    expect(select).toBeDisabled();
  });

  it('create payload includes scope when chatroom scope is selected', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(
      <SavedCommandModal
        isOpen={true}
        chatroomId="room-1"
        onClose={onClose}
        onCreated={onCreated}
        existingNamesByScope={emptyNamesByScope}
      />
    );

    await user.type(screen.getByLabelText(/^name$/i), 'Test Cmd');
    await user.type(screen.getByLabelText(/^prompt$/i), 'Test prompt');

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
    render(
      <SavedCommandModal
        isOpen={true}
        chatroomId="room-1"
        onClose={onClose}
        existingNamesByScope={emptyNamesByScope}
      />
    );

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

  it('renders scope hint text when scope is selected', () => {
    render(
      <SavedCommandModal
        isOpen={true}
        chatroomId="room-1"
        onClose={vi.fn()}
        existingNamesByScope={emptyNamesByScope}
      />
    );

    expect(screen.getByText('Available only in this chatroom.')).toBeInTheDocument();
  });

  it('opens with defaultScope="user" pre-selects user scope', () => {
    const onClose = vi.fn();
    render(
      <SavedCommandModal
        isOpen={true}
        chatroomId="room-1"
        onClose={onClose}
        existingNamesByScope={emptyNamesByScope}
        defaultScope="user"
      />
    );

    const scopeSelect = screen.getByLabelText(/^scope$/i) as HTMLSelectElement;
    expect(scopeSelect.value).toBe('user');
  });
});
