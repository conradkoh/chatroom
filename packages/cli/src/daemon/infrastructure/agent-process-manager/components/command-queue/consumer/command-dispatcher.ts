import type { LifecycleCommand } from '../entities/lifecycle-command.js';

export interface LifecycleCommandHandler {
  start(command: Extract<LifecycleCommand, { type: 'start' }>): Promise<void>;
  stop(command: Extract<LifecycleCommand, { type: 'stop' }>): Promise<void>;
  restart(command: Extract<LifecycleCommand, { type: 'restart' }>): Promise<void>;
  recover(command: Extract<LifecycleCommand, { type: 'recover' }>): Promise<void>;
}

export function createLifecycleCommandDispatcher(
  handler: LifecycleCommandHandler
): (command: LifecycleCommand) => Promise<void> {
  return async (command) => {
    switch (command.type) {
      case 'start':
        return handler.start(command);
      case 'stop':
        return handler.stop(command);
      case 'restart':
        return handler.restart(command);
      case 'recover':
        return handler.recover(command);
    }
  };
}
