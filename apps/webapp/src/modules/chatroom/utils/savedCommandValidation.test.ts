import { describe, expect, it } from 'vitest';

import { checkDuplicateSavedCommandName } from './savedCommandValidation';

import type { SavedCommandScope } from '../types/savedCommand';

const emptyNamesByScope: Record<SavedCommandScope, string[]> = { user: [], chatroom: [] };

describe('checkDuplicateSavedCommandName', () => {
  const namesByScope: Record<SavedCommandScope, string[]> = {
    user: [],
    chatroom: ['Existing Cmd', 'Another'],
  };

  it('returns null when no duplicate exists in the scope', () => {
    const result = checkDuplicateSavedCommandName('My Command', 'chatroom', namesByScope);
    expect(result).toBeNull();
  });

  it('returns null when duplicate exists in other scope but not current scope', () => {
    const result = checkDuplicateSavedCommandName('Existing Cmd', 'user', namesByScope);
    expect(result).toBeNull();
  });

  it('returns error message when duplicate exists in current scope (case-insensitive)', () => {
    const result = checkDuplicateSavedCommandName('existing cmd', 'chatroom', namesByScope);
    expect(result).toBe('A command named "existing cmd" already exists in this chatroom scope.');
  });

  it('returns null when no names exist in that scope', () => {
    const result = checkDuplicateSavedCommandName('Anything', 'user', emptyNamesByScope);
    expect(result).toBeNull();
  });

  it('allows saving same name in edit mode (self-exclusion)', () => {
    const result = checkDuplicateSavedCommandName('Existing Cmd', 'chatroom', namesByScope, {
      isEditMode: true,
      initialName: 'Existing Cmd',
      initialScope: 'chatroom',
    });
    expect(result).toBeNull();
  });

  it('is case-insensitive for self-exclusion in edit mode', () => {
    const result = checkDuplicateSavedCommandName('existing cmd', 'chatroom', namesByScope, {
      isEditMode: true,
      initialName: 'Existing Cmd',
      initialScope: 'chatroom',
    });
    expect(result).toBeNull();
  });

  it('still catches duplicate in edit mode if different command has same name', () => {
    const result = checkDuplicateSavedCommandName('Another', 'chatroom', namesByScope, {
      isEditMode: true,
      initialName: 'Existing Cmd',
      initialScope: 'chatroom',
    });
    expect(result).toBe('A command named "Another" already exists in this chatroom scope.');
  });

  it("ignores self-exclusion when initialScope doesn't match current scope", () => {
    const result = checkDuplicateSavedCommandName('Existing Cmd', 'chatroom', namesByScope, {
      isEditMode: true,
      initialName: 'Existing Cmd',
      initialScope: 'user',
    });
    expect(result).toBe('A command named "Existing Cmd" already exists in this chatroom scope.');
  });
});
