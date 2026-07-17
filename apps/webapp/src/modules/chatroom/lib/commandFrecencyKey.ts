import type { CommandItem } from '../components/CommandPalette/types';

/**
 * Stable key for command usage / frécency tracking.
 * Decoupled from display label so renames and scope suffixes don't reset stats.
 */
export function getCommandFrecencyKey(command: CommandItem): string {
  // Saved commands: id is `saved-cmd-${_id}`
  if (command.id.startsWith('saved-cmd-')) return command.id;
  // Favorites: id is `fav-${name}`
  if (command.id.startsWith('fav-')) return command.id;
  // Built-ins and workspace commands: id is already unique
  return command.id;
}

/** Resolve cmdk value (label) → frecency key using a prebuilt map. */
export function resolveFrecencyKeyFromLabel(
  label: string,
  labelToKey: ReadonlyMap<string, string>
): string {
  return labelToKey.get(label) ?? label;
}
