import type { Message } from '../types/message';

// fallow-ignore-next-line complexity
export function countMessageAttachments(message: Message): number {
  return [
    message.attachedTasks,
    message.attachedBacklogItems,
    message.attachedMessages,
    message.attachedSnippets,
  ].reduce((sum, items) => sum + (items?.length ?? 0), 0);
}
