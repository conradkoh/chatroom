import { describe, expect, test } from 'vitest';

import { sortCommandsByFrecency } from './sortCommandsByFrecency';
import type { CommandItem } from '../components/CommandPalette/types';

function makeCmd(id: string, label: string): CommandItem {
  return { id, label, category: 'Test', action: () => undefined };
}

describe('sortCommandsByFrecency', () => {
  test('higher-scored command sorts first regardless of array order', () => {
    const cmds = [makeCmd('saved-cmd-low', 'Low'), makeCmd('saved-cmd-high', 'High')];
    const scores = new Map([
      ['saved-cmd-high', 200],
      ['saved-cmd-low', 50],
    ]);
    const result = sortCommandsByFrecency(cmds, scores);
    expect(result[0].id).toBe('saved-cmd-high');
    expect(result[1].id).toBe('saved-cmd-low');
  });

  test('preserves original order for equal scores', () => {
    const cmds = [makeCmd('cmd-a', 'A'), makeCmd('cmd-b', 'B'), makeCmd('cmd-c', 'C')];
    const scores = new Map([
      ['cmd-a', 100],
      ['cmd-b', 100],
      ['cmd-c', 100],
    ]);
    const result = sortCommandsByFrecency(cmds, scores);
    expect(result.map((c) => c.id)).toEqual(['cmd-a', 'cmd-b', 'cmd-c']);
  });

  test('commands without score sort after scored ones preserving input order', () => {
    const cmds = [makeCmd('no-score', 'No Score'), makeCmd('scored', 'Scored')];
    const scores = new Map([['scored', 150]]);
    const result = sortCommandsByFrecency(cmds, scores);
    expect(result[0].id).toBe('scored');
    expect(result[1].id).toBe('no-score');
  });
});
