import type { ReceivedCommandMessage } from '../entities/command-message.js';

export interface HandleReceiveCommandsInput {
  maxNumberOfMessages?: number;
  visibilityTimeoutMs?: number;
}

export interface HandleReceiveCommandsDependencies {
  receiveMessages<T>(options?: HandleReceiveCommandsInput): Promise<ReceivedCommandMessage<T>[]>;
}

export function handleReceiveCommands<T>(
  deps: HandleReceiveCommandsDependencies,
  input?: HandleReceiveCommandsInput
): Promise<ReceivedCommandMessage<T>[]> {
  return deps.receiveMessages(input);
}
