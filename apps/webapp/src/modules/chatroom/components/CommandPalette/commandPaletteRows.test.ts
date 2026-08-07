import { describe, expect, it } from 'vitest';

import {
  buildCommandPaletteRows,
  filterCommandsForSearch,
  filterCommandsForSearchWithBlacklist,
} from './commandPaletteRows';
import type { CommandItem } from './types';

function makeCmd(id: string, label: string, category = 'Test'): CommandItem {
  return { id, label, category, action: () => undefined };
}

function passthroughFilter(_value: string, _search: string): number {
  return 1;
}

describe('filterCommandsForSearch', () => {
  it('returns all commands when search is empty', () => {
    const cmds = [makeCmd('a', 'Alpha'), makeCmd('b', 'Beta')];
    expect(filterCommandsForSearch(cmds, '', passthroughFilter)).toHaveLength(2);
  });

  it('filters by rankedFilter and sorts by score descending', () => {
    const cmds = [makeCmd('a', 'Alpha'), makeCmd('b', 'Beta')];
    const filter = (value: string, _search: string) => (value === 'Beta' ? 10 : 5);
    const result = filterCommandsForSearch(cmds, 'search', filter);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('b');
  });

  it('moves blacklisted commands to end in search results', () => {
    const cmds = [makeCmd('a', 'Alpha'), makeCmd('b', 'Beta'), makeCmd('c', 'Gamma')];
    const blacklisted = new Set(['b']);
    const result = filterCommandsForSearchWithBlacklist(
      cmds,
      'search',
      passthroughFilter,
      blacklisted
    );
    expect(result.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('excludes commands with score 0', () => {
    const cmds = [makeCmd('a', 'Alpha'), makeCmd('b', 'Beta')];
    const filter = (value: string, _search: string) => (value === 'Alpha' ? 10 : 0);
    const result = filterCommandsForSearch(cmds, 'search', filter);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });
});

describe('buildCommandPaletteRows', () => {
  function makeArgs(overrides?: Partial<Parameters<typeof buildCommandPaletteRows>[0]>) {
    return {
      commands: [],
      search: '',
      rankedFilter: passthroughFilter,
      recentCommands: [],
      groupedCommands: new Map(),
      getScore: () => 0,
      frecencyScores: new Map(),
      ...overrides,
    };
  }

  it('returns filtered item rows in search mode', () => {
    const cmds = [makeCmd('a', 'Alpha'), makeCmd('b', 'Beta')];
    const rows = buildCommandPaletteRows(makeArgs({ search: 'al', commands: cmds }));
    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe('item');
  });

  it('returns heading + items in browse mode with recent section', () => {
    const recent = [makeCmd('r1', 'Recent1')];
    const groups = new Map<string, CommandItem[]>([['Work', [makeCmd('w1', 'Work1', 'Work')]]]);
    const rows = buildCommandPaletteRows(
      makeArgs({ recentCommands: recent, groupedCommands: groups })
    );
    expect(rows[0]).toEqual({ type: 'heading', id: 'recent', label: 'Recent' });
    expect(rows[1].type).toBe('item');
    expect(rows[1].id).toBe('r1');
    expect(rows[2]).toEqual({ type: 'heading', id: 'heading-Work', label: 'Work' });
    expect(rows[3].type).toBe('item');
    expect(rows[3].id).toBe('w1');
  });

  it('moves blacklisted commands to end in browse mode', () => {
    const cmds = [makeCmd('a', 'Alpha'), makeCmd('b', 'Beta')];
    const groups = new Map<string, CommandItem[]>([['Test', cmds]]);
    const blacklisted = new Set(['a']);
    const rows = buildCommandPaletteRows(
      makeArgs({ groupedCommands: groups, blacklistedKeys: blacklisted })
    );
    expect(rows.map((r) => r.id)).toEqual(['heading-Test', 'b', 'a']);
  });

  it('moves blacklisted recent commands to end', () => {
    const recent = [makeCmd('a', 'Alpha'), makeCmd('b', 'Beta')];
    const blacklisted = new Set(['a']);
    const rows = buildCommandPaletteRows(
      makeArgs({ recentCommands: recent, blacklistedKeys: blacklisted })
    );
    expect(rows.map((r) => r.id)).toEqual(['recent', 'b', 'a']);
  });

  it('treats workspace commands with different ids as same blacklist key in browse mode', () => {
    const cmds = [
      {
        id: 'ws-roomA-open-vscode',
        label: 'Open VS Code',
        category: 'Actions',
        action: () => undefined,
      },
      {
        id: 'ws-roomB-open-vscode',
        label: 'Open VS Code',
        category: 'Actions',
        action: () => undefined,
      },
    ];
    const groups = new Map<string, typeof cmds>([['Actions', cmds]]);
    const rows = buildCommandPaletteRows(
      makeArgs({ groupedCommands: groups, blacklistedKeys: new Set(['ws-open-vscode']) })
    );
    // Both should be blacklisted since they share the semantic key
    expect(rows.map((r) => r.id)).toEqual([
      'heading-Actions',
      'ws-roomA-open-vscode',
      'ws-roomB-open-vscode',
    ]);
  });

  it('deduplicates recent commands from category groups', () => {
    const cmd = makeCmd('dup', 'Dup');
    const recent = [cmd];
    const groups = new Map<string, CommandItem[]>([['Test', [cmd]]]);
    const rows = buildCommandPaletteRows(
      makeArgs({ recentCommands: recent, groupedCommands: groups })
    );
    expect(rows).toHaveLength(2); // Recent heading + item; no Test group heading
  });
});
