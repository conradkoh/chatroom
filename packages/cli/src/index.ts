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
  .option(
    '--message-id <messageId>',
    'Specific message ID to classify (optional, will find latest if not provided)'
  )
  .option(
    '--task-id <taskId>',
    'Task ID to find the associated message (optional, mutually exclusive with --message-id)'
  )
  .option('--title <title>', 'Feature title (required for new_feature)')
  .option(
    '--description-file <path>',
    'Path to file containing feature description (required for new_feature)'
  )
  .option(
    '--tech-specs-file <path>',
    'Path to file containing technical specifications (required for new_feature)'
  )
  .action(
    async (
      chatroomId: string,
      options: {
        role: string;
        classification: string;
        messageId?: string;
        taskId?: string;
        title?: string;
        descriptionFile?: string;
        techSpecsFile?: string;
      }
    ) => {
      await maybeRequireAuth();

      // Validate that only one of messageId or taskId is provided
      if (options.messageId && options.taskId) {
        console.error('❌ Cannot specify both --message-id and --task-id. Use one or the other.');
        console.error('   --message-id: Classify a specific message by its ID');
        console.error('   --task-id: Classify the message associated with a task');
        console.error('   If neither is provided, will find the latest unclassified message');
        process.exit(1);
      }

      const validClassifications = ['question', 'new_feature', 'follow_up'];
      if (!validClassifications.includes(options.classification)) {
        console.error(
          `❌ Invalid classification: ${
            options.classification
          }. Must be one of: ${validClassifications.join(', ')}`
        );
        process.exit(1);
      }

      // Read content from files
      const { readFileContent } = await import('./utils/file-content.js');
      let description: string | undefined;
      let techSpecs: string | undefined;

      try {
        if (options.descriptionFile) {
          description = readFileContent(options.descriptionFile, 'description-file');
        }
        if (options.techSpecsFile) {
          techSpecs = readFileContent(options.techSpecsFile, 'tech-specs-file');
        }
      } catch (err) {
        console.error(`❌ ${(err as Error).message}`);
        process.exit(1);
      }

      const { taskStarted } = await import('./commands/task-started.js');
      await taskStarted(chatroomId, {
        role: options.role,
        classification: options.classification as 'question' | 'new_feature' | 'follow_up',
        messageId: options.messageId,
        taskId: options.taskId,
        title: options.title,
        description,
        techSpecs,
      });
    }
  );

program
  .command('handoff <chatroomId>')
  .description('Complete your task and hand off to the next role')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--message-file <path>', 'Path to file containing completion message')
  .requiredOption('--next-role <nextRole>', 'Role to hand off to')
  .option(
    '--attach-artifact <artifactId>',
    'Attach artifact to handoff (can be used multiple times)',
    (value: string, previous: string[]) => {
      return previous ? [...previous, value] : [value];
    },
    []
  )
  .action(
    async (
      chatroomId: string,
      options: {
        role: string;
        messageFile: string;
        nextRole: string;
        attachArtifact?: string[];
      }
    ) => {
      await maybeRequireAuth();

      // Read content from file
      const { readFileContent } = await import('./utils/file-content.js');
      let message: string;

      try {
        message = readFileContent(options.messageFile, 'message-file');
      } catch (err) {
        console.error(`❌ ${(err as Error).message}`);
        process.exit(1);
      }

      // Validate that message is not empty
      if (!message || message.trim().length === 0) {
        console.error('❌ Message file is empty');
        process.exit(1);
      }

      const { handoff } = await import('./commands/handoff.js');
      await handoff(chatroomId, {
        role: options.role,
        message,
        nextRole: options.nextRole,
        attachedArtifactIds: options.attachArtifact || [],
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
  .requiredOption(
    '--status <status>',
    'Filter by status (pending|in_progress|queued|backlog|completed|cancelled|active|pending_review|archived|all)'
  )
  .option('--limit <n>', 'Maximum number of tasks to show (required for --status=all)')
  .option('--full', 'Show full task content without truncation')
  .action(
    async (
      chatroomId: string,
      options: { role: string; status: string; limit?: string; full?: boolean }
    ) => {
      // Validate: --status=all requires --limit
      if (options.status === 'all' && !options.limit) {
        console.error('❌ When using --status=all, you must specify --limit=<n>');
        console.error(
          '   Example: chatroom backlog list <id> --role=builder --status=all --limit=50'
        );
        process.exit(1);
      }
      await maybeRequireAuth();
      const { listBacklog } = await import('./commands/backlog.js');
      await listBacklog(chatroomId, {
        role: options.role,
        status: options.status,
        limit: options.limit ? parseInt(options.limit, 10) : 20,
        full: options.full,
      });
    }
  );

backlogCommand
  .command('add <chatroomId>')
  .description('Add a task to the backlog')
  .requiredOption('--role <role>', 'Your role (creator)')
  .requiredOption('--content-file <path>', 'Path to file containing task content')
  .action(async (chatroomId: string, options: { role: string; contentFile: string }) => {
    await maybeRequireAuth();

    // Read content from file
    const { readFileContent } = await import('./utils/file-content.js');
    let content: string;

    try {
      content = readFileContent(options.contentFile, 'content-file');
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }

    // Validate that content is not empty
    if (!content || content.trim().length === 0) {
      console.error('❌ Content file is empty');
      process.exit(1);
    }

    const { addBacklog } = await import('./commands/backlog.js');
    await addBacklog(chatroomId, { role: options.role, content });
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

backlogCommand
  .command('reopen <chatroomId>')
  .description('Reopen a completed backlog task, returning it to pending_user_review status.')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--task-id <taskId>', 'Task ID to reopen')
  .action(async (chatroomId: string, options: { role: string; taskId: string }) => {
    await maybeRequireAuth();
    const { reopenBacklog } = await import('./commands/backlog.js');
    await reopenBacklog(chatroomId, options);
  });

backlogCommand
  .command('patch-task <chatroomId>')
  .description('Update task scoring fields (complexity, value, priority)')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--task-id <taskId>', 'Task ID to patch')
  .option('--complexity <level>', 'Complexity level (low|medium|high)')
  .option('--value <level>', 'Value level (low|medium|high)')
  .option('--priority <n>', 'Priority number (higher = more important)')
  .action(
    async (
      chatroomId: string,
      options: {
        role: string;
        taskId: string;
        complexity?: string;
        value?: string;
        priority?: string;
      }
    ) => {
      await maybeRequireAuth();
      const { patchBacklog } = await import('./commands/backlog.js');
      await patchBacklog(chatroomId, options);
    }
  );

backlogCommand
  .command('reset-task <chatroomId>')
  .description('Reset a stuck in_progress task back to pending')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--task-id <taskId>', 'Task ID to reset')
  .action(async (chatroomId: string, options: { role: string; taskId: string }) => {
    await maybeRequireAuth();
    const { resetBacklog } = await import('./commands/backlog.js');
    await resetBacklog(chatroomId, options);
  });

// ============================================================================
// MESSAGES COMMANDS (auth required)
// ============================================================================

const messagesCommand = program
  .command('messages')
  .description('List and filter chatroom messages');

messagesCommand
  .command('list <chatroomId>')
  .description('List messages by sender role or since a specific message')
  .requiredOption('--role <role>', 'Your role')
  .option('--sender-role <senderRole>', 'Filter by sender role (e.g., user, builder, reviewer)')
  .option('--since-message-id <messageId>', 'Get all messages since this message ID (inclusive)')
  .option('--limit <n>', 'Maximum number of messages to show')
  .option('--full', 'Show full message content without truncation')
  .action(
    async (
      chatroomId: string,
      options: {
        role: string;
        senderRole?: string;
        sinceMessageId?: string;
        limit?: string;
        full?: boolean;
      }
    ) => {
      // Validate: must specify either --sender-role or --since-message-id
      if (!options.senderRole && !options.sinceMessageId) {
        console.error('❌ Must specify either --sender-role or --since-message-id');
        console.error('   Examples:');
        console.error(
          '     chatroom messages list <id> --role=builder --sender-role=user --limit=3'
        );
        console.error('     chatroom messages list <id> --role=builder --since-message-id=<msgId>');
        process.exit(1);
      }

      // Cannot use both options together
      if (options.senderRole && options.sinceMessageId) {
        console.error('❌ Cannot use both --sender-role and --since-message-id at the same time');
        process.exit(1);
      }

      await maybeRequireAuth();

      if (options.senderRole) {
        const { listBySenderRole } = await import('./commands/messages.js');
        await listBySenderRole(chatroomId, {
          role: options.role,
          senderRole: options.senderRole,
          limit: options.limit ? parseInt(options.limit, 10) : 10,
          full: options.full,
        });
      } else if (options.sinceMessageId) {
        const { listSinceMessage } = await import('./commands/messages.js');
        await listSinceMessage(chatroomId, {
          role: options.role,
          sinceMessageId: options.sinceMessageId,
          limit: options.limit ? parseInt(options.limit, 10) : 100,
          full: options.full,
        });
      }
    }
  );

// ============================================================================
// GUIDELINES COMMANDS (auth required)
// ============================================================================

const guidelinesCommand = program
  .command('guidelines')
  .description('View review guidelines by type');

guidelinesCommand
  .command('view')
  .description('View guidelines for a specific review type')
  .requiredOption('--type <type>', 'Guideline type (coding|security|design|performance|all)')
  .action(async (options: { type: string }) => {
    await maybeRequireAuth();
    const { viewGuidelines } = await import('./commands/guidelines.js');
    await viewGuidelines(options);
  });

guidelinesCommand
  .command('list')
  .description('List available guideline types')
  .action(async () => {
    await maybeRequireAuth();
    const { listGuidelineTypes } = await import('./commands/guidelines.js');
    await listGuidelineTypes();
  });

// ============================================================================
// ARTIFACT COMMANDS (auth required)
// ============================================================================

const artifactCommand = program.command('artifact').description('Manage artifacts for handoffs');

artifactCommand
  .command('create <chatroomId>')
  .description('Create a new artifact from a file')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--from-file <path>', 'Path to file containing artifact content')
  .requiredOption('--filename <filename>', 'Display filename for the artifact')
  .option('--description <description>', 'Optional description of the artifact')
  .action(
    async (
      chatroomId: string,
      options: {
        role: string;
        fromFile: string;
        filename: string;
        description?: string;
      }
    ) => {
      await maybeRequireAuth();
      const { createArtifact } = await import('./commands/artifact.js');
      await createArtifact(chatroomId, options);
    }
  );

artifactCommand
  .command('view <chatroomId> <artifactId>')
  .description('View a single artifact')
  .requiredOption('--role <role>', 'Your role')
  .action(async (chatroomId: string, artifactId: string, options: { role: string }) => {
    await maybeRequireAuth();
    const { viewArtifact } = await import('./commands/artifact.js');
    await viewArtifact(chatroomId, { role: options.role, artifactId });
  });

artifactCommand
  .command('view-many <chatroomId>')
  .description('View multiple artifacts')
  .requiredOption('--role <role>', 'Your role')
  .option(
    '--artifact <artifactId>',
    'Artifact ID to view (can be used multiple times)',
    (value: string, previous: string[]) => {
      return previous ? [...previous, value] : [value];
    },
    []
  )
  .action(async (chatroomId: string, options: { role: string; artifact?: string[] }) => {
    await maybeRequireAuth();
    const { viewManyArtifacts } = await import('./commands/artifact.js');
    await viewManyArtifacts(chatroomId, {
      role: options.role,
      artifactIds: options.artifact || [],
    });
  });

// ============================================================================
// OPENCODE COMMANDS (no auth required)
// ============================================================================

const opencodeCommand = program.command('opencode').description('OpenCode integration tools');

opencodeCommand
  .command('install')
  .description('Install chatroom as an OpenCode tool')
  .option('--force', 'Overwrite existing tool installation')
  .action(async (options: { force?: boolean }) => {
    const { installTool } = await import('./commands/opencode-install.js');
    await installTool({ checkExisting: !options.force });
  });

program.parse();
