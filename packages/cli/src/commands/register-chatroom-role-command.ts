import type { Command } from 'commander';

type ChatroomRoleCommandOptions = { chatroomId: string; role: string };

/** Register a chatroom+role CLI command with shared options and auth gate. */
export function registerChatroomRoleCommand(
  program: Command,
  config: {
    name: string;
    description: string;
    run: (chatroomId: string, options: Pick<ChatroomRoleCommandOptions, 'role'>) => Promise<void>;
    maybeRequireAuth: () => Promise<void>;
  }
): void {
  program
    .command(config.name)
    .description(config.description)
    .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
    .requiredOption('--role <role>', 'Your role (e.g., planner, builder)')
    .action(async (options: ChatroomRoleCommandOptions) => {
      await config.maybeRequireAuth();
      await config.run(options.chatroomId, { role: options.role });
    });
}
