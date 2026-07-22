import type { CommandItem } from '../components/CommandPalette/types';
import { parseWorkspaceCommandBlacklistKeyFromId } from './workspaceCommandBlacklistKey';

export function getCommandBlacklistKey(command: CommandItem): string {
  if (command.blacklistKey) return command.blacklistKey;

  const wsKey = parseWorkspaceCommandBlacklistKeyFromId(command.id);
  if (wsKey) return wsKey;

  if (command.id.startsWith('saved-cmd-')) {
    const labelMatch = command.label.match(/^Command: (.+?) \((?:User|Chatroom)\)$/);
    if (labelMatch) return `saved-cmd:${labelMatch[1]}`;
  }

  return command.id;
}
