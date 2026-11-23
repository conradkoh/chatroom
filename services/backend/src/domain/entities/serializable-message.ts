import type { DeliveryAttachmentsInput } from './message-attachments';

/** Harness + model of the agent that sent a handoff, as recorded on the message. Informational. */
export interface SerializableSenderAgent {
  harness: string;
  model?: string | undefined;
}

/** Canonical message record for all history serialization profiles. */
export interface SerializableMessage {
  _id: string;
  _creationTime: number;
  senderRole: string;
  targetRole?: string | null | undefined;
  type: string;
  content: string;
  attachments?: DeliveryAttachmentsInput | undefined;
  task?: { _id: string; status: string; content: string } | undefined;
  senderAgent?: SerializableSenderAgent | undefined;
}
