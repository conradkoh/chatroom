import type { SentCommandMessage } from '../entities/command-message.js';

export interface HandleSendCommandInput<T> {
  body: T;
  messageGroupId: string;
  deduplicationId?: string;
}

export interface HandleSendCommandDependencies {
  sendMessage<T>(input: HandleSendCommandInput<T>): Promise<SentCommandMessage>;
}

export function handleSendCommand<T>(
  deps: HandleSendCommandDependencies,
  input: HandleSendCommandInput<T>
): Promise<SentCommandMessage> {
  return deps.sendMessage(input);
}
