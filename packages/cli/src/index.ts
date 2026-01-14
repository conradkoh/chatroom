#!/usr/bin/env bun
/**
 * Chatroom CLI
 *
 * CLI for multi-agent chatroom collaboration.
 * Run `chatroom --help` for usage information.
 */

import { Command } from 'commander';

const program = new Command();

program.name('chatroom').description('CLI for multi-agent chatroom collaboration').version('1.0.0');

// TODO: Add commands as they are migrated
// These will be implemented in separate files under src/commands/

program
  .command('init')
  .description('Initialize configuration file (.chatroom/chatroom.jsonc)')
  .option('-f, --force', 'Overwrite existing configuration')
  .action(async (options: { force?: boolean }) => {
    const { initConfig } = await import('./commands/init.js');
    await initConfig(options);
  });

program
  .command('create')
  .description('Create a new chatroom')
  .option('-t, --team <teamId>', 'Team to use (default: from config)')
  .action(async (options: { team?: string }) => {
    const { createChatroom } = await import('./commands/create.js');
    await createChatroom(options);
  });

program
  .command('list')
  .description('List chatroom history')
  .action(async () => {
    const { listChatrooms } = await import('./commands/list.js');
    await listChatrooms();
  });

program
  .command('complete <chatroomId>')
  .description('Mark a chatroom as completed')
  .action(async (chatroomId: string) => {
    const { completeChatroom } = await import('./commands/complete.js');
    await completeChatroom(chatroomId);
  });

program
  .command('wait-for-message <chatroomId>')
  .description('Join a chatroom and wait for messages')
  .requiredOption('--role <role>', 'Role to join as (e.g., builder, reviewer)')
  .option('--timeout <ms>', 'Optional timeout in milliseconds')
  .action(async (chatroomId: string, options: { role: string; timeout?: string }) => {
    const { waitForMessage } = await import('./commands/wait-for-message.js');
    await waitForMessage(chatroomId, {
      role: options.role,
      timeout: options.timeout ? parseInt(options.timeout, 10) : undefined,
    });
  });

program
  .command('send <chatroomId>')
  .description('Send a message to a chatroom')
  .requiredOption('--message <message>', 'Message content to send')
  .option('--role <role>', 'Sender role', 'user')
  .option('--skip-ready-check', 'Send even if team is not ready')
  .action(
    async (
      chatroomId: string,
      options: { message: string; role?: string; skipReadyCheck?: boolean }
    ) => {
      const { sendMessage } = await import('./commands/send.js');
      await sendMessage(chatroomId, options);
    }
  );

program
  .command('task-complete <chatroomId>')
  .description('Complete a task and hand off to the next role')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--message <message>', 'Completion message/summary')
  .requiredOption('--next-role <nextRole>', 'Role to hand off to')
  .option('--no-wait', 'Exit instead of waiting for next message')
  .action(
    async (
      chatroomId: string,
      options: { role: string; message: string; nextRole: string; wait?: boolean }
    ) => {
      const { taskComplete } = await import('./commands/task-complete.js');
      await taskComplete(chatroomId, { ...options, noWait: options.wait === false });
    }
  );

program.parse();
