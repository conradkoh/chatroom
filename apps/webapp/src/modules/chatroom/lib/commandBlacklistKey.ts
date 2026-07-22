import type { CommandItem } from '../components/CommandPalette/types';

export function getCommandBlacklistKey(command: CommandItem): string {
  if (command.blacklistKey) return command.blacklistKey;

  const wsMatch = command.id.match(/^ws-[^-]+-(.+)$/);
  if (wsMatch) return `ws-${wsMatch[1]}`;

  if (command.id.startsWith('saved-cmd-')) {
    const labelMatch = command.label.match(/^Command: (.+?) \((?:User|Chatroom)\)$/);
    if (labelMatch) return `saved-cmd:${labelMatch[1]}`;
  }

  return command.id;
}
