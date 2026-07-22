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
});
