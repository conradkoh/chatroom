import type { CommandItem } from '../components/CommandPalette/types';
import { getCommandBlacklistKey } from './commandBlacklistKey';

export function partitionCommandsByBlacklist(
  commands: CommandItem[],
  blacklistedKeys: ReadonlySet<string>
): CommandItem[] {
  if (blacklistedKeys.size === 0) return commands;
  const normal: CommandItem[] = [];
  const blacklisted: CommandItem[] = [];
  for (const cmd of commands) {
    (blacklistedKeys.has(getCommandBlacklistKey(cmd)) ? blacklisted : normal).push(cmd);
  }
  return [...normal, ...blacklisted];
}
