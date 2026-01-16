#!/usr/bin/env node
/**
 * Chatroom CLI
 *
 * CLI for multi-agent chatroom collaboration.
 * Run `chatroom --help` for usage information.
 */

import { Command } from 'commander';

import { getVersion } from './version.js';

const program = new Command();

program
  .name('chatroom')
  .description('CLI for multi-agent chatroom collaboration')
  .version(getVersion())
  .option('--skip-auth', 'Skip authentication check (development only)');

// Helper to check if auth should be skipped
function shouldSkipAuth(): boolean {
  // Check global options
  const opts = program.opts();
  return opts.skipAuth === true;
}

// Helper to conditionally require auth
async function maybeRequireAuth(): Promise<void> {
  if (shouldSkipAuth()) {
    console.log('⚠️  Skipping authentication (--skip-auth flag)');
    return;
  }
  const { requireAuth } = await import('./infrastructure/auth/middleware.js');
  await requireAuth();
}

// ============================================================================
// AUTH COMMANDS (no auth required)
// ============================================================================

const authCommand = program.command('auth').description('Manage CLI authentication');

authCommand
  .command('login')
  .description('Authenticate the CLI via browser')
  .option('-f, --force', 'Re-authenticate even if already logged in')
  .action(async (options: { force?: boolean }) => {
    const { authLogin } = await import('./commands/auth-login.js');
    await authLogin(options);
  });

authCommand
  .command('logout')
  .description('Clear CLI authentication')
  .action(async () => {
    const { authLogout } = await import('./commands/auth-logout.js');
    await authLogout();
  });

authCommand
  .command('status')
  .description('Show current authentication status')
  .action(async () => {
    const { authStatus } = await import('./commands/auth-status.js');
    await authStatus();
  });

// ============================================================================
// INIT COMMAND (no auth required)
// ============================================================================

program
  .command('init')
  .description('Initialize configuration file (.chatroom/chatroom.jsonc)')
  .option('-f, --force', 'Overwrite existing configuration')
  .action(async (options: { force?: boolean }) => {
    const { initConfig } = await import('./commands/init.js');
    await initConfig(options);
  });

// ============================================================================
// UPDATE COMMAND (no auth required)
// ============================================================================

program
  .command('update')
  .description('Update the CLI to the latest version')
  .action(async () => {
    const { update } = await import('./commands/update.js');
    await update();
  });

// ============================================================================
// CHATROOM COMMANDS (auth required unless --skip-auth)
// ============================================================================

program
  .command('create')
  .description('Create a new chatroom')
  .option('-t, --team <teamId>', 'Team to use (default: from config)')
  .action(async (options: { team?: string }) => {
    await maybeRequireAuth();
    const { createChatroom } = await import('./commands/create.js');
    await createChatroom(options);
  });

program
  .command('list')
  .description('List chatroom history')
  .action(async () => {
    await maybeRequireAuth();
    const { listChatrooms } = await import('./commands/list.js');
    await listChatrooms();
  });

program
  .command('complete <chatroomId>')
  .description('Mark a chatroom as completed')
  .action(async (chatroomId: string) => {
    await maybeRequireAuth();
    const { completeChatroom } = await import('./commands/complete.js');
    await completeChatroom(chatroomId);
  });

program
  .command('wait-for-message <chatroomId>')
  .description('Join a chatroom and wait for messages')
  .requiredOption('--role <role>', 'Role to join as (e.g., builder, reviewer)')
  .option('--timeout <ms>', 'Optional timeout in milliseconds (deprecated, use --duration)')
  .option('--duration <duration>', 'How long to wait (e.g., "1m", "5m", "30s")')
  .action(
    async (chatroomId: string, options: { role: string; timeout?: string; duration?: string }) => {
      await maybeRequireAuth();
      const { waitForMessage, parseDuration } = await import('./commands/wait-for-message.js');

      // Parse duration if provided, otherwise fall back to timeout
      let timeoutMs: number | undefined;
      if (options.duration) {
        const parsed = parseDuration(options.duration);
        if (parsed === null) {
          console.error(
            `❌ Invalid duration format: "${options.duration}". Use formats like "1m", "5m", "30s".`
          );
          process.exit(1);
        }
        timeoutMs = parsed;
      } else if (options.timeout) {
        timeoutMs = parseInt(options.timeout, 10);
      }

      await waitForMessage(chatroomId, {
        role: options.role,
        timeout: timeoutMs,
        duration: options.duration,
      });
    }
  );

program
  .command('task-started <chatroomId>')
  .description('Acknowledge a task and classify the user message')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption(
    '--classification <type>',
    'Message classification: question, new_feature, or follow_up'
  )
  .action(async (chatroomId: string, options: { role: string; classification: string }) => {
    await maybeRequireAuth();
    const validClassifications = ['question', 'new_feature', 'follow_up'];
    if (!validClassifications.includes(options.classification)) {
      console.error(
        `❌ Invalid classification: ${
          options.classification
        }. Must be one of: ${validClassifications.join(', ')}`
      );
      process.exit(1);
    }
    const { taskStarted } = await import('./commands/task-started.js');
    await taskStarted(chatroomId, {
      role: options.role,
      classification: options.classification as 'question' | 'new_feature' | 'follow_up',
    });
  });

// New command name: handoff (preferred)
program
  .command('handoff <chatroomId>')
  .description('Complete your task and hand off to the next role')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--message <message>', 'Completion message/summary')
  .requiredOption('--next-role <nextRole>', 'Role to hand off to')
  .option('--no-wait', 'Exit instead of waiting for next message')
  .action(
    async (
      chatroomId: string,
      options: {
        role: string;
        message: string;
        nextRole: string;
        wait?: boolean;
      }
    ) => {
      await maybeRequireAuth();
      const { taskComplete } = await import('./commands/task-complete.js');
      await taskComplete(chatroomId, {
        ...options,
        noWait: options.wait === false,
      });
    }
  );

// Deprecated: use handoff instead
program
  .command('task-complete <chatroomId>')
  .description('[DEPRECATED: Use "handoff" instead] Complete a task and hand off to the next role')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--message <message>', 'Completion message/summary')
  .requiredOption('--next-role <nextRole>', 'Role to hand off to')
  .option('--no-wait', 'Exit instead of waiting for next message')
  .action(
    async (
      chatroomId: string,
      options: {
        role: string;
        message: string;
        nextRole: string;
        wait?: boolean;
      }
    ) => {
      console.warn('⚠️  The "task-complete" command is deprecated. Use "handoff" instead.');
      await maybeRequireAuth();
      const { taskComplete } = await import('./commands/task-complete.js');
      await taskComplete(chatroomId, {
        ...options,
        noWait: options.wait === false,
      });
    }
  );

// ============================================================================
// BACKLOG COMMANDS (auth required)
// ============================================================================

const backlogCommand = program.command('backlog').description('Manage task queue and backlog');

backlogCommand
  .command('list <chatroomId>')
  .description('List tasks in a chatroom')
  .requiredOption('--role <role>', 'Your role')
  .option(
    '--status <status>',
    'Filter by status (pending|in_progress|queued|backlog|active|all)',
    'active'
  )
  .option('--limit <n>', 'Maximum number of tasks to show', '20')
  .action(
    async (chatroomId: string, options: { role: string; status?: string; limit?: string }) => {
      await maybeRequireAuth();
      const { listBacklog } = await import('./commands/backlog.js');
      await listBacklog(chatroomId, {
        role: options.role,
        status: options.status,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });
    }
  );

backlogCommand
  .command('add <chatroomId>')
  .description('Add a task to the backlog')
  .requiredOption('--role <role>', 'Your role (creator)')
  .requiredOption('--content <content>', 'Task content/description')
  .action(async (chatroomId: string, options: { role: string; content: string }) => {
    await maybeRequireAuth();
    const { addBacklog } = await import('./commands/backlog.js');
    await addBacklog(chatroomId, options);
  });

backlogCommand
  .command('complete <chatroomId>')
  .description('Mark a task as complete. Use --force for stuck in_progress/pending tasks.')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--task-id <taskId>', 'Task ID to complete')
  .option('-f, --force', 'Force complete a stuck in_progress or pending task')
  .action(
    async (chatroomId: string, options: { role: string; taskId: string; force?: boolean }) => {
      await maybeRequireAuth();
      const { completeBacklog } = await import('./commands/backlog.js');
      await completeBacklog(chatroomId, options);
    }
  );

program.parse();
