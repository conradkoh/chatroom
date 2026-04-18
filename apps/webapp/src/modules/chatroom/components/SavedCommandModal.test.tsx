import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (must be before imports that use them) ─────────────────────────────

const mockCreateSavedCommand = vi.fn();
const mockUpdateSavedCommand = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (mutationRef: unknown) => {
    // Return create or update mock based on which mutation is requested
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

// ── Imports ───────────────────────────────────────────────────────────────────

import { checkDuplicateName, SavedCommandModal } from './SavedCommandModal';

// ── Unit Tests: checkDuplicateName ──────────────────────────────────────────

describe('checkDuplicateName', () => {
  it('returns null when no duplicate exists', () => {
    const result = checkDuplicateName('My Command', ['Other Command', 'Another'], false);
    expect(result).toBeNull();
  });

  it('returns error message when duplicate exists (case-insensitive)', () => {
    const result = checkDuplicateName('my command', ['My Command', 'Another'], false);
    expect(result).toBe('A command named "my command" already exists.');
  });

  it('allows saving same name in edit mode (self-exclusion)', () => {
    const result = checkDuplicateName(
      'My Command',
      ['My Command', 'Another'],
      true,
      'My Command'
    );
    expect(result).toBeNull();
  });

  it('is case-insensitive for self-exclusion in edit mode', () => {
    const result = checkDuplicateName(
      'my command',
      ['My Command', 'Another'],
      true,
      'My Command'
    );
    expect(result).toBeNull();
  });

  it('still catches duplicate in edit mode if different command has same name', () => {
    const result = checkDuplicateName(
      'Other Command',
      ['My Command', 'Other Command'],
      true,
      'My Command'
    );
    expect(result).toBe('A command named "Other Command" already exists.');
  });
});

// ── Component Tests: SavedCommandModal ──────────────────────────────────────

describe('SavedCommandModal component', () => {
  beforeEach(() => {
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
      />
    );

    await userEvent.type(screen.getByLabelText(/name/i), 'My Command');
    await userEvent.type(screen.getByLabelText(/prompt/i), 'Do something useful');

    await userEvent.click(screen.getByRole('button', { name: /save command/i }));

    await waitFor(() => {
      expect(mockCreateSavedCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Command',
          prompt: 'Do something useful',
        })
      );
    });
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls updateSavedCommand when commandId is provided (edit mode)', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(
      <SavedCommandModal
        isOpen={true}
        chatroomId="room-1"
        onClose={onClose}
        onCreated={onCreated}
        commandId="cmd-abc"
        initialName="Old Name"
        initialPrompt="Old prompt"
      />
    );

    const nameInput = screen.getByLabelText(/name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Name');

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateSavedCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          commandId: 'cmd-abc',
          name: 'New Name',
          prompt: 'Old prompt',
        })
      );
    });
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape key closes the modal', () => {
    const onClose = vi.fn();
    render(
      <SavedCommandModal isOpen={true} chatroomId="room-1" onClose={onClose} />
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
        existingNames={['Foo']}
      />
    );

    await userEvent.type(screen.getByLabelText(/name/i), 'foo');
    await userEvent.type(screen.getByLabelText(/prompt/i), 'some prompt');

    await userEvent.click(screen.getByRole('button', { name: /save command/i }));

    await waitFor(() => {
      expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    });
    expect(mockCreateSavedCommand).not.toHaveBeenCalled();
  });
});
