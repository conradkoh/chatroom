import type { Message } from '../types/message';

import type { TimelineEvent } from './types';

/**
 * Maps a feed {@link Message} to a linear timeline event.
 *
 * Classification:
 * - `new-context` → context divider
 * - `senderRole=user` + `type=message` → user message
 * - everything else → team message
 */
export function mapMessageToTimelineEvent(message: Message): TimelineEvent {
  const base = {
    id: message._id,
    creationTime: message._creationTime,
  };

  if (message.type === 'new-context') {
    return { ...base, kind: 'context', message };
  }

  const isUserMessage =
    message.senderRole.toLowerCase() === 'user' && message.type === 'message';

  if (isUserMessage) {
    return { ...base, kind: 'user_message', message };
  }

  return { ...base, kind: 'team_message', message };
}
