import type {
  CommandMessage,
  ReceivedCommandMessage,
  SentCommandMessage,
} from '../entities/command-message.js';

export interface SendCommandMessageInput<T> {
  body: T;
  messageGroupId: string;
  deduplicationId?: string;
}

export interface ReceiveCommandMessagesOptions {
  maxNumberOfMessages?: number;
  visibilityTimeoutMs?: number;
}

export type PurgeCommandMessagesInput =
  | { readonly scope: 'all' }
  | { readonly scope: 'message-group-prefix'; readonly messageGroupPrefix: string };

export interface CommandQueue<T> {
  sendMessage(input: SendCommandMessageInput<T>): Promise<SentCommandMessage>;
  receiveMessages(options?: ReceiveCommandMessagesOptions): Promise<ReceivedCommandMessage<T>[]>;
  deleteMessage(receiptHandle: string): Promise<void>;
  changeMessageVisibility(receiptHandle: string, visibilityTimeoutMs: number): Promise<void>;
  /** Remove matching queued and leased messages and return what was removed. */
  purge(input: PurgeCommandMessagesInput): Promise<CommandMessage<T>[]>;
}
