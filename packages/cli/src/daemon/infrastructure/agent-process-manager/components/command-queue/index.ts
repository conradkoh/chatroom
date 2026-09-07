/** Public command-queue component surface and composition root. */

import { InMemoryCommandQueue } from './infra/in-memory-command-queue.js';
import type { CommandQueueStore } from './infra/store/command-queue-store.js';
import { InMemoryCommandQueueStore } from './infra/store/in-memory-command-queue-store.js';
import type { CommandQueue } from './interfaces/command-queue.js';

export { CommandQueueConsumer } from './consumer/command-queue-consumer.js';
export {
  createLifecycleCommandDispatcher,
  type LifecycleCommandHandler,
} from './consumer/command-dispatcher.js';
export type {
  CommandQueueConsumerDependencies,
  CommandQueueConsumerOptions,
} from './consumer/types.js';

export interface CommandQueueOptions<T> {
  store?: CommandQueueStore<T>;
  now?: () => number;
  generateMessageId?: () => string;
  generateReceiptHandle?: () => string;
  deduplicationWindowMs?: number;
}

/** Constructs the command queue with its configured storage strategy. */
export function createCommandQueue<T>(options: CommandQueueOptions<T> = {}): CommandQueue<T> {
  const store = options.store ?? new InMemoryCommandQueueStore<T>();
  return new InMemoryCommandQueue({ ...options, store });
}

export type {
  CommandMessage,
  ReceivedCommandMessage,
  SentCommandMessage,
} from './entities/command-message.js';
export type { LifecycleCommand } from './entities/lifecycle-command.js';
export type {
  CommandQueue,
  ReceiveCommandMessagesOptions,
  SendCommandMessageInput,
} from './interfaces/command-queue.js';
export type { CommandQueueStore, StoredCommandMessage } from './infra/store/command-queue-store.js';
export { InMemoryCommandQueueStore } from './infra/store/in-memory-command-queue-store.js';

export type {
  HandleChangeCommandVisibilityDependencies,
  HandleChangeCommandVisibilityInput,
} from './usecase/handle-change-command-visibility.js';
export { handleChangeCommandVisibility } from './usecase/handle-change-command-visibility.js';
export type { HandleDeleteCommandDependencies } from './usecase/handle-delete-command.js';
export { handleDeleteCommand } from './usecase/handle-delete-command.js';
export type {
  HandleReceiveCommandsDependencies,
  HandleReceiveCommandsInput,
} from './usecase/handle-receive-commands.js';
export { handleReceiveCommands } from './usecase/handle-receive-commands.js';
export type {
  HandleSendCommandDependencies,
  HandleSendCommandInput,
} from './usecase/handle-send-command.js';
export { handleSendCommand } from './usecase/handle-send-command.js';
