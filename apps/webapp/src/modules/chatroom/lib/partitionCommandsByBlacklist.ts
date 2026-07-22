import type { CommandItem } from '../components/CommandPalette/types';

export function partitionCommandsByBlacklist(
  commands: CommandItem[],
  blacklistedIds: ReadonlySet<string>
): CommandItem[] {
  if (blacklistedIds.size === 0) return commands;
  const normal: CommandItem[] = [];
  const blacklisted: CommandItem[] = [];
  for (const cmd of commands) {
    (blacklistedIds.has(cmd.id) ? blacklisted : normal).push(cmd);
  }
  return [...normal, ...blacklisted];
}
