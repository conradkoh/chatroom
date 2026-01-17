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
  .command('wait-for-task <chatroomId>')
  .description('Join a chatroom and wait for tasks')
  .requiredOption('--role <role>', 'Role to join as (e.g., builder, reviewer)')
  .option('--timeout <ms>', 'Optional timeout in milliseconds (deprecated, use --duration)')
  .option('--duration <duration>', 'How long to wait (e.g., "1m", "5m", "30s")')
  .action(
    async (chatroomId: string, options: { role: string; timeout?: string; duration?: string }) => {
      await maybeRequireAuth();
      const { waitForTask, parseDuration } = await import('./commands/wait-for-task.js');

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

      await waitForTask(chatroomId, {
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
  .option('--title <title>', 'Feature title (required for new_feature)')
  .option('--description <description>', 'Feature description (required for new_feature)')
  .option('--tech-specs <specs>', 'Technical specifications (required for new_feature)')
  .action(
    async (
      chatroomId: string,
      options: {
        role: string;
        classification: string;
        title?: string;
        description?: string;
        techSpecs?: string;
      }
    ) => {
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
        title: options.title,
        description: options.description,
        techSpecs: options.techSpecs,
      });
    }
  );

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
      const { handoff } = await import('./commands/handoff.js');
      await handoff(chatroomId, {
        ...options,
        noWait: options.wait === false,
      });
    }
  );

// ============================================================================
// FEATURE COMMANDS (auth required)
// ============================================================================

const featureCommand = program.command('feature').description('Browse and inspect features');

featureCommand
  .command('list <chatroomId>')
  .description('List features in a chatroom')
  .option('--limit <n>', 'Maximum number of features to show', '10')
  .action(async (chatroomId: string, options: { limit?: string }) => {
    await maybeRequireAuth();
    const { listFeatures } = await import('./commands/feature.js');
    await listFeatures(chatroomId, {
      limit: options.limit ? parseInt(options.limit, 10) : undefined,
    });
  });

featureCommand
  .command('inspect <chatroomId> <messageId>')
  .description('Inspect a specific feature')
  .action(async (chatroomId: string, messageId: string) => {
    await maybeRequireAuth();
    const { inspectFeature } = await import('./commands/feature.js');
    await inspectFeature(chatroomId, messageId);
  });

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
