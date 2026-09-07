import type { ReceivedCommandMessage, SentCommandMessage } from '../entities/command-message.js';

export interface SendCommandMessageInput<T> {
  body: T;
  messageGroupId: string;
  deduplicationId?: string;
}

export interface ReceiveCommandMessagesOptions {
  maxNumberOfMessages?: number;
  visibilityTimeoutMs?: number;
}

export interface CommandQueue<T> {
  sendMessage(input: SendCommandMessageInput<T>): Promise<SentCommandMessage>;
  receiveMessages(options?: ReceiveCommandMessagesOptions): Promise<ReceivedCommandMessage<T>[]>;
  deleteMessage(receiptHandle: string): Promise<void>;
  changeMessageVisibility(receiptHandle: string, visibilityTimeoutMs: number): Promise<void>;
}
