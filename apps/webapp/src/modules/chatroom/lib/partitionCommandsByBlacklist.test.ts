import { describe, expect, it } from 'vitest';

import { partitionCommandsByBlacklist } from './partitionCommandsByBlacklist';
import type { CommandItem } from '../components/CommandPalette/types';

function makeCmd(id: string, label: string): CommandItem {
  return { id, label, category: 'Test', action: () => undefined };
}

describe('partitionCommandsByBlacklist', () => {
  it('returns commands unchanged when blacklist is empty', () => {
    const cmds = [makeCmd('a', 'A'), makeCmd('b', 'B')];
    expect(partitionCommandsByBlacklist(cmds, new Set())).toEqual(cmds);
  });

  it('moves blacklisted commands to end while preserving order', () => {
    const cmds = [makeCmd('a', 'A'), makeCmd('b', 'B'), makeCmd('c', 'C')];
    const result = partitionCommandsByBlacklist(cmds, new Set(['b']));
    expect(result.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('handles multiple blacklisted commands', () => {
    const cmds = [makeCmd('a', 'A'), makeCmd('b', 'B'), makeCmd('c', 'C')];
    const result = partitionCommandsByBlacklist(cmds, new Set(['a', 'c']));
    expect(result.map((c) => c.id)).toEqual(['b', 'a', 'c']);
  });

  it('preserves relative order within blacklisted group', () => {
    const cmds = [makeCmd('a', 'A'), makeCmd('b', 'B'), makeCmd('c', 'C')];
    const result = partitionCommandsByBlacklist(cmds, new Set(['a', 'b', 'c']));
    expect(result.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('treats workspace commands with different ids as same blacklist key', () => {
    const cmds = [
      makeCmd('ws-roomA-open-vscode', 'Open VS Code'),
      makeCmd('ws-roomB-open-vscode', 'Open VS Code'),
      makeCmd('nav-go-to-file', 'Go to file'),
    ];
    const result = partitionCommandsByBlacklist(cmds, new Set(['ws-open-vscode']));
    expect(result.map((c) => c.id)).toEqual([
      'nav-go-to-file',
      'ws-roomA-open-vscode',
      'ws-roomB-open-vscode',
    ]);
  });
});
