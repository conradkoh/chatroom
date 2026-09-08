/** Message as stored by the command queue. */
export interface CommandMessage<T> {
  messageId: string;
  messageGroupId: string;
  body: T;
  enqueuedAt: number;
  receiveCount: number;
}

/** Message returned to a consumer with a temporary processing lease. */
export interface ReceivedCommandMessage<T> extends CommandMessage<T> {
  receiptHandle: string;
  visibilityExpiresAt: number;
}

export interface SentCommandMessage {
  messageId: string;
  messageGroupId: string;
  enqueuedAt: number;
}
