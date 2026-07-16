import { getCommandFrecencyKey } from './commandFrecencyKey';
import type { CommandItem } from '../components/CommandPalette/types';

function getFrecencyScoreForCommand(
  command: CommandItem,
  scores: ReadonlyMap<string, number>
): number {
  return scores.get(getCommandFrecencyKey(command)) ?? 0;
}

/** Sort descending by frécency score; stable tie-breaker = original index. */
export function sortCommandsByFrecency(
  commands: CommandItem[],
  scores: ReadonlyMap<string, number>
): CommandItem[] {
  return commands
    .map((cmd, index) => ({ cmd, index, score: getFrecencyScoreForCommand(cmd, scores) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ cmd }) => cmd);
}
