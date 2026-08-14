import type { ChatroomLogEntry } from '../../../infrastructure/log-server/chatroom-log-store.js';
import type { ChatroomLogSink } from '../../../infrastructure/log-server/log-server.js';

export type AppendChatroomLogInput = Omit<ChatroomLogEntry, 'timestamp'> & { timestamp?: number };

export function appendChatroomLog(
  sink: ChatroomLogSink | undefined,
  input: AppendChatroomLogInput
): void {
  if (!sink) return;
  sink.writeChatroomLog({
    ...input,
    timestamp: input.timestamp ?? Date.now(),
  });
}
