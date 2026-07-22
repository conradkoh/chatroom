import type { CommandItem } from './types';
import { sortCommandsByFrecency } from '../../lib/sortCommandsByFrecency';
import { partitionCommandsByBlacklist } from '../../lib/partitionCommandsByBlacklist';

type FrecencyScores = Map<string, number>;

export type CommandPaletteRow =
  | { type: 'heading'; id: string; label: string }
  | { type: 'item'; id: string; command: CommandItem };

export const COMMAND_PALETTE_ITEM_ROW_HEIGHT = 32;
export const COMMAND_PALETTE_ITEM_WITH_DETAIL_ROW_HEIGHT = 46;
export const COMMAND_PALETTE_HEADING_ROW_HEIGHT = 28;

export function filterCommandsForSearch(
  commands: CommandItem[],
  search: string,
  rankedFilter: (value: string, search: string, keywords?: string[]) => number
): CommandItem[] {
  const q = search.trim();
  if (!q) return [...commands];
  const result = commands
    .filter((cmd) => rankedFilter(cmd.label, q, cmd.keywords) > 0)
    .sort((a, b) => rankedFilter(b.label, q, b.keywords) - rankedFilter(a.label, q, a.keywords));
  return result;
}

export function filterCommandsForSearchWithBlacklist(
  commands: CommandItem[],
  search: string,
  rankedFilter: (value: string, search: string, keywords?: string[]) => number,
  blacklistedIds: ReadonlySet<string>
): CommandItem[] {
  const result = filterCommandsForSearch(commands, search, rankedFilter);
  return partitionCommandsByBlacklist(result, blacklistedIds);
}

export interface BuildCommandPaletteRowsArgs {
  commands: CommandItem[];
  search: string;
  rankedFilter: (value: string, search: string, keywords?: string[]) => number;
  recentCommands: CommandItem[];
  groupedCommands: Map<string, CommandItem[]>;
  getScore: (cmd: CommandItem) => number;
  frecencyScores: FrecencyScores;
  blacklistedIds?: ReadonlySet<string>;
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
  blacklistedIds = new Set(),
}: BuildCommandPaletteRowsArgs): CommandPaletteRow[] {
  const isSearching = search.trim().length > 0;

  if (isSearching) {
    const filtered = filterCommandsForSearchWithBlacklist(
      commands,
      search,
      rankedFilter,
      blacklistedIds
    );
    return filtered.map((cmd) => ({ type: 'item' as const, id: cmd.id, command: cmd }));
  }

  const rows: CommandPaletteRow[] = [];
  const recentIds = new Set(recentCommands.map((c) => c.id));

  if (recentCommands.length > 0) {
    rows.push({ type: 'heading', id: 'recent', label: 'Recent' });
    for (const cmd of partitionCommandsByBlacklist(
      sortCommandsByFrecency(recentCommands, frecencyScores),
      blacklistedIds
    )) {
      rows.push({ type: 'item', id: cmd.id, command: cmd });
    }
  }

  for (const [category, items] of groupedCommands) {
    const itemsToShow =
      recentCommands.length > 0 ? items.filter((item) => !recentIds.has(item.id)) : items;
    if (itemsToShow.length === 0) continue;
    rows.push({ type: 'heading', id: `heading-${category}`, label: category });
    for (const cmd of partitionCommandsByBlacklist(itemsToShow, blacklistedIds)) {
      rows.push({ type: 'item', id: cmd.id, command: cmd });
    }
  }

  return rows;
}
