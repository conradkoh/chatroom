import type { ChatroomEventRecord } from '../../../infrastructure/log-server/log-store.js';

export function createLogEventIngestionUseCase(deps: {
  writer: { writeChatroomEvent(event: ChatroomEventRecord): void };
}) {
  return (event: ChatroomEventRecord): { accepted: true } => {
    deps.writer.writeChatroomEvent(event);
    return { accepted: true };
  };
}
