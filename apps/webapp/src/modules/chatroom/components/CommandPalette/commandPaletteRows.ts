import type { CommandItem } from './types';
import { sortCommandsByFrecency } from '../../lib/sortCommandsByFrecency';

type FrecencyScores = Map<string, number>;

export type CommandPaletteRow =
  | { type: 'heading'; id: string; label: string }
  | { type: 'item'; id: string; command: CommandItem };

export const COMMAND_PALETTE_ITEM_ROW_HEIGHT = 44;
export const COMMAND_PALETTE_HEADING_ROW_HEIGHT = 28;

export function filterCommandsForSearch(
  commands: CommandItem[],
  search: string,
  rankedFilter: (value: string, search: string, keywords?: string[]) => number
): CommandItem[] {
  const q = search.trim();
  if (!q) return [...commands];
  return commands
    .filter((cmd) => rankedFilter(cmd.label, q, cmd.keywords) > 0)
    .sort((a, b) => rankedFilter(b.label, q, b.keywords) - rankedFilter(a.label, q, a.keywords));
}

export interface BuildCommandPaletteRowsArgs {
  commands: CommandItem[];
  search: string;
  rankedFilter: (value: string, search: string, keywords?: string[]) => number;
  recentCommands: CommandItem[];
  groupedCommands: Map<string, CommandItem[]>;
  getScore: (cmd: CommandItem) => number;
  frecencyScores: FrecencyScores;
}

// fallow-ignore-next-line complexity
export function buildCommandPaletteRows({
  commands,
  search,
  rankedFilter,
  recentCommands,
  groupedCommands,
  getScore: _getScore,
  frecencyScores,
}: BuildCommandPaletteRowsArgs): CommandPaletteRow[] {
  const isSearching = search.trim().length > 0;

  if (isSearching) {
    const filtered = filterCommandsForSearch(commands, search, rankedFilter);
    return filtered.map((cmd) => ({ type: 'item' as const, id: cmd.id, command: cmd }));
  }

  const rows: CommandPaletteRow[] = [];
  const recentIds = new Set(recentCommands.map((c) => c.id));

  if (recentCommands.length > 0) {
    rows.push({ type: 'heading', id: 'recent', label: 'Recent' });
    for (const cmd of sortCommandsByFrecency(recentCommands, frecencyScores)) {
      rows.push({ type: 'item', id: cmd.id, command: cmd });
    }
  }

  for (const [category, items] of groupedCommands) {
    const itemsToShow =
      recentCommands.length > 0 ? items.filter((item) => !recentIds.has(item.id)) : items;
    if (itemsToShow.length === 0) continue;
    rows.push({ type: 'heading', id: `heading-${category}`, label: category });
    for (const cmd of itemsToShow) {
      rows.push({ type: 'item', id: cmd.id, command: cmd });
    }
  }

  return rows;
}
