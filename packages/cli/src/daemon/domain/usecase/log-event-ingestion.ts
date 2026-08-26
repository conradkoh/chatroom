import type {
  ChatroomEventRecord,
  EventStreamEntry,
} from '../../../infrastructure/log-server/log-store.js';

export function createLogEventIngestionUseCase(deps: {
  writer: { writeChatroomEvent(event: ChatroomEventRecord): EventStreamEntry };
}) {
  return (event: ChatroomEventRecord): EventStreamEntry => deps.writer.writeChatroomEvent(event);
}
