import { describe, expect, test } from 'vitest';

import type { CommandItem } from './types';
import { createRankedFilter } from '../../lib/frecencyScoring';
import { sortCommandsByFrecency } from '../../lib/sortCommandsByFrecency';

function makeCmd(id: string, label: string, category = 'Test'): CommandItem {
  return { id, label, category, action: () => undefined };
}

function mockFuzzy(value: string, search: string): number {
  if (search.length === 0) return 1;
  return value.toLowerCase().includes(search.toLowerCase()) ? 10 : 0;
}

describe('command palette ranking integration', () => {
  test('built-in command with 3 usages ranks above saved command with 1 usage', () => {
    const savedCmd = makeCmd('saved-cmd-save', 'Command: Save (Chatroom)');
    const builtinCmd = makeCmd('nav-codebase', 'Agentic Search');

    // saved has lower frecency (1 usage), builtin has higher (3 usages)
    const scores = new Map([
      ['saved-cmd-save', 50],
      ['nav-codebase', 200],
    ]);

    const cmds = [savedCmd, builtinCmd];
    const sorted = sortCommandsByFrecency(cmds, scores);

    expect(sorted[0].id).toBe('nav-codebase');
    expect(sorted[1].id).toBe('saved-cmd-save');
  });

  test('ranked filter with empty search boosts higher frecency command', () => {
    const scores = new Map([
      ['saved-cmd-save', 50],
      ['nav-codebase', 200],
    ]);
    const resolveKey = (label: string) => {
      if (label === 'Command: Save (Chatroom)') return 'saved-cmd-save';
      if (label === 'Agentic Search') return 'nav-codebase';
      return label;
    };

    const filter = createRankedFilter(mockFuzzy, scores, resolveKey);

    const scoreSaved = filter('Command: Save (Chatroom)', '');
    const scoreBuiltin = filter('Agentic Search', '');

    // Builtin should rank higher due to higher frecency
    expect(scoreBuiltin).toBeGreaterThan(scoreSaved);
  });

  test('search mode still ranks higher frecency command higher', () => {
    const scores = new Map([
      ['saved-cmd-build', 50],
      ['fav-build', 200],
    ]);
    const resolveKey = (label: string) => {
      if (label === 'Build CLI') return 'saved-cmd-build';
      if (label === 'build-web') return 'fav-build';
      return label;
    };

    const filter = createRankedFilter(mockFuzzy, scores, resolveKey);

    // Both match 'build' but the favorite has higher frecency
    const scoreSaved = filter('Build CLI', 'build');
    const scoreFav = filter('build-web', 'build');

    expect(scoreFav).toBeGreaterThan(scoreSaved);
  });

  test('commands without frecency appear after scored ones in browse sort', () => {
    const noScoreCmd = makeCmd('nav-new', 'New Command');
    const scoredCmd = makeCmd('nav-common', 'Common Command');
    const scores = new Map([['nav-common', 100]]);
    const cmds = [noScoreCmd, scoredCmd];

    const sorted = sortCommandsByFrecency(cmds, scores);

    expect(sorted[0].id).toBe('nav-common');
    expect(sorted[1].id).toBe('nav-new');
  });
});
