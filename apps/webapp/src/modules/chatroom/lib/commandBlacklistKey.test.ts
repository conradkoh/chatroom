import { describe, expect, it } from 'vitest';

import { getCommandBlacklistKey } from './commandBlacklistKey';
import type { CommandItem } from '../components/CommandPalette/types';

function makeCmd(overrides: Partial<CommandItem> & Pick<CommandItem, 'id' | 'label'>): CommandItem {
  return { category: 'Test', action: () => undefined, ...overrides };
}

describe('getCommandBlacklistKey', () => {
  it('built-in command returns its id', () => {
    expect(getCommandBlacklistKey(makeCmd({ id: 'nav-go-to-file', label: 'Go to file' }))).toBe(
      'nav-go-to-file'
    );
  });

  it('favorite command returns its id', () => {
    expect(getCommandBlacklistKey(makeCmd({ id: 'fav-lint', label: 'lint' }))).toBe('fav-lint');
  });

  it('workspace command strips workspace id', () => {
    const result = getCommandBlacklistKey(
      makeCmd({ id: 'ws-abc-open-vscode', label: 'Open VS Code' })
    );
    expect(result).toBe('ws-open-vscode');
  });

  it('different workspace ids produce same key', () => {
    const a = getCommandBlacklistKey(makeCmd({ id: 'ws-abc-open-vscode', label: 'Open VS Code' }));
    const b = getCommandBlacklistKey(makeCmd({ id: 'ws-xyz-open-vscode', label: 'Open VS Code' }));
    expect(a).toBe(b);
  });

  it('saved command with blacklistKey uses it', () => {
    const result = getCommandBlacklistKey(
      makeCmd({
        id: 'saved-cmd-id1',
        label: 'Command: deploy (User)',
        blacklistKey: 'saved-cmd:deploy',
      })
    );
    expect(result).toBe('saved-cmd:deploy');
  });

  it('saved command fallback extracts from label', () => {
    const result = getCommandBlacklistKey(
      makeCmd({ id: 'saved-cmd-id1', label: 'Command: deploy (User)' })
    );
    expect(result).toBe('saved-cmd:deploy');
  });

  it('saved command fallback with Chatroom scope', () => {
    const result = getCommandBlacklistKey(
      makeCmd({ id: 'saved-cmd-id2', label: 'Command: lint (Chatroom)' })
    );
    expect(result).toBe('saved-cmd:lint');
  });

  it('saved command without matching label pattern returns raw id', () => {
    const result = getCommandBlacklistKey(makeCmd({ id: 'saved-cmd-id1', label: 'Custom Label' }));
    expect(result).toBe('saved-cmd-id1');
  });
});
