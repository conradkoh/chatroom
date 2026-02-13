#!/usr/bin/env node
/**
 * Chatroom CLI
 *
 * CLI for multi-agent chatroom collaboration.
 * Run `chatroom --help` for usage information.
 */

import { Command } from 'commander';

import { readStdin } from './utils/stdin.js';
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
  .command('register-agent')
  .description('Register agent type for a chatroom role')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Role to register as (e.g., builder, reviewer)')
  .requiredOption('--type <type>', 'Agent type: remote or custom')
  .action(async (options: { chatroomId: string; role: string; type: string }) => {
    await maybeRequireAuth();

    // Validate type
    if (options.type !== 'remote' && options.type !== 'custom') {
      console.error(`❌ Invalid agent type: "${options.type}". Must be "remote" or "custom".`);
      process.exit(1);
    }

    const { registerAgent } = await import('./commands/register-agent.js');
    await registerAgent(options.chatroomId, {
      role: options.role,
      type: options.type as 'remote' | 'custom',
    });
  });

program
  .command('wait-for-task')
  .description('Join a chatroom and wait for tasks')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Role to join as (e.g., builder, reviewer)')
  .action(async (options: { chatroomId: string; role: string }) => {
    await maybeRequireAuth();
    const { waitForTask } = await import('./commands/wait-for-task.js');

    await waitForTask(options.chatroomId, {
      role: options.role,
    });
  });

program
  .command('task-started')
  .description('Acknowledge a task and optionally classify the user message')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .option(
    '--origin-message-classification <type>',
    'Original message classification: question, new_feature, or follow_up (for entry point roles)'
  )
  .option(
    '--no-classify',
    'Skip classification (for handoff recipients - classification already done by entry point)'
  )
  .requiredOption('--task-id <taskId>', 'Task ID to acknowledge')
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      originMessageClassification?: string;
      classify?: boolean; // Note: Commander.js sets this to false when --no-classify is used
      taskId: string;
    }) => {
      await maybeRequireAuth();

      // Commander.js converts --no-classify to classify: false
      const skipClassification = options.classify === false;

      // Validate: must have either --no-classify or --origin-message-classification
      if (!skipClassification && !options.originMessageClassification) {
        console.error(`❌ Either --no-classify or --origin-message-classification is required`);
        console.error('');
        console.error('   For entry point roles (receiving user messages):');
        console.error('     Use --origin-message-classification=<type>');
        console.error('');
        console.error('   For handoff recipients (receiving from other agents):');
        console.error('     Use --no-classify');
        process.exit(1);
      }

      // Validate: can't have both
      if (skipClassification && options.originMessageClassification) {
        console.error(`❌ Cannot use both --no-classify and --origin-message-classification`);
        console.error(
          '   Use --no-classify for handoffs, or --origin-message-classification for user messages'
        );
        process.exit(1);
      }

      // Validate classification type if provided
      if (options.originMessageClassification) {
        const validClassifications = ['question', 'new_feature', 'follow_up'];
        if (!validClassifications.includes(options.originMessageClassification)) {
          console.error(
            `❌ Invalid classification: ${
              options.originMessageClassification
            }. Must be one of: ${validClassifications.join(', ')}`
          );
          process.exit(1);
        }
      }

      // For new_feature, read stdin and pass it directly to backend
      let rawStdin: string | undefined;
      if (options.originMessageClassification === 'new_feature') {
        const stdinContent = await readStdin();

        if (!stdinContent.trim()) {
          console.error(
            '❌ Stdin is empty. For new_feature classification, provide:\n---TITLE---\n[title]\n---DESCRIPTION---\n[description]\n---TECH_SPECS---\n[specs]'
          );
          process.exit(1);
        }

        rawStdin = stdinContent;
      }

      const { taskStarted } = await import('./commands/task-started.js');
      await taskStarted(options.chatroomId, {
        role: options.role,
        originMessageClassification: options.originMessageClassification as
          | 'question'
          | 'new_feature'
          | 'follow_up'
          | undefined,
        taskId: options.taskId,
        rawStdin,
        noClassify: skipClassification,
      });
    }
  );

program
  .command('task-complete')
  .description('Complete the current task without handing off to another role')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .action(async (options: { chatroomId: string; role: string }) => {
    await maybeRequireAuth();

    const { taskComplete } = await import('./commands/task-complete.js');
    await taskComplete(options.chatroomId, {
      role: options.role,
    });
  });

program
  .command('handoff')
  .description('Complete your task and hand off to the next role')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
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
    async (options: {
      chatroomId: string;
      role: string;
      nextRole: string;
      attachArtifact?: string[];
    }) => {
      await maybeRequireAuth();

      // Read message from stdin
      const { decode } = await import('./utils/serialization/decode/index.js');
      const stdinContent = await readStdin();

      let message: string;
      try {
        const result = decode(stdinContent, { singleParam: 'message' });
        message = result.message;
      } catch (err) {
        console.error(`❌ Failed to decode stdin: ${(err as Error).message}`);
        process.exit(1);
      }

      // Validate that message is not empty
      if (!message || message.trim().length === 0) {
        console.error('❌ Message is empty');
        process.exit(1);
      }

      const { handoff } = await import('./commands/handoff.js');
      await handoff(options.chatroomId, {
        role: options.role,
        message,
        nextRole: options.nextRole,
        attachedArtifactIds: options.attachArtifact || [],
      });
    }
  );

program
  .command('report-progress')
  .description('Report progress on current task (does not complete the task)')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .action(async (options: { chatroomId: string; role: string }) => {
    await maybeRequireAuth();

    // Read message from stdin (mandatory)
    const { decode } = await import('./utils/serialization/decode/index.js');
    const stdinContent = await readStdin();

    if (!stdinContent.trim()) {
      console.error('❌ No message provided via stdin');
      console.error("   Usage: chatroom report-progress --chatroom-id=<id> --role=<role> << 'EOF'");
      console.error('   Your progress message here');
      console.error('   EOF');
      process.exit(1);
    }

    let message: string;
    try {
      const result = decode(stdinContent, { singleParam: 'message' });
      message = result.message;
    } catch (err) {
      console.error(`❌ Failed to decode stdin: ${(err as Error).message}`);
      process.exit(1);
    }

    // Validate that message is not empty
    if (!message || message.trim().length === 0) {
      console.error('❌ Progress message cannot be empty');
      process.exit(1);
    }

    const { reportProgress } = await import('./commands/report-progress.js');
    await reportProgress(options.chatroomId, {
      role: options.role,
      message,
    });
  });

// ============================================================================
// BACKLOG COMMANDS (auth required)
// ============================================================================

const backlogCommand = program.command('backlog').description('Manage task queue and backlog');

backlogCommand
  .command('list')
  .description('List tasks in a chatroom')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption(
    '--status <status>',
    'Filter by status (pending|in_progress|queued|backlog|completed|cancelled|active|pending_review|archived|all)'
  )
  .option('--limit <n>', 'Maximum number of tasks to show (required for --status=all)')
  .option('--full', 'Show full task content without truncation')
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      status: string;
      limit?: string;
      full?: boolean;
    }) => {
      // Validate: --status=all requires --limit
      if (options.status === 'all' && !options.limit) {
        console.error('❌ When using --status=all, you must specify --limit=<n>');
        console.error(
          '   Example: chatroom backlog list --chatroom-id=<id> --role=builder --status=all --limit=50'
        );
        process.exit(1);
      }
      await maybeRequireAuth();
      const { listBacklog } = await import('./commands/backlog.js');
      await listBacklog(options.chatroomId, {
        role: options.role,
        status: options.status,
        limit: options.limit ? parseInt(options.limit, 10) : 20,
        full: options.full,
      });
    }
  );

backlogCommand
  .command('add')
  .description('Add a task to the backlog')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role (creator)')
  .requiredOption('--content-file <path>', 'Path to file containing task content')
  .action(async (options: { chatroomId: string; role: string; contentFile: string }) => {
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
    await addBacklog(options.chatroomId, { role: options.role, content });
  });

backlogCommand
  .command('complete')
  .description('Mark a task as complete. Use --force for stuck in_progress/pending tasks.')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--task-id <taskId>', 'Task ID to complete')
  .option('-f, --force', 'Force complete a stuck in_progress or pending task')
  .action(
    async (options: { chatroomId: string; role: string; taskId: string; force?: boolean }) => {
      await maybeRequireAuth();
      const { completeBacklog } = await import('./commands/backlog.js');
      await completeBacklog(options.chatroomId, options);
    }
  );

backlogCommand
  .command('reopen')
  .description('Reopen a completed backlog task, returning it to pending_user_review status.')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--task-id <taskId>', 'Task ID to reopen')
  .action(async (options: { chatroomId: string; role: string; taskId: string }) => {
    await maybeRequireAuth();
    const { reopenBacklog } = await import('./commands/backlog.js');
    await reopenBacklog(options.chatroomId, options);
  });

backlogCommand
  .command('patch-task')
  .description('Update task scoring fields (complexity, value, priority)')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--task-id <taskId>', 'Task ID to patch')
  .option('--complexity <level>', 'Complexity level (low|medium|high)')
  .option('--value <level>', 'Value level (low|medium|high)')
  .option('--priority <n>', 'Priority number (higher = more important)')
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      taskId: string;
      complexity?: string;
      value?: string;
      priority?: string;
    }) => {
      await maybeRequireAuth();
      const { patchBacklog } = await import('./commands/backlog.js');
      await patchBacklog(options.chatroomId, options);
    }
  );

backlogCommand
  .command('score')
  .description('Score a backlog task by complexity, value, and priority')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--task-id <taskId>', 'Task ID to score')
  .option('--complexity <level>', 'Complexity level: low, medium, high')
  .option('--value <level>', 'Value level: low, medium, high')
  .option('--priority <n>', 'Priority number (higher = more important)')
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      taskId: string;
      complexity?: string;
      value?: string;
      priority?: string;
    }) => {
      await maybeRequireAuth();
      const { scoreBacklog } = await import('./commands/backlog.js');
      await scoreBacklog(options.chatroomId, options);
    }
  );

backlogCommand
  .command('reset-task')
  .description('Reset a stuck in_progress task back to pending')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--task-id <taskId>', 'Task ID to reset')
  .action(async (options: { chatroomId: string; role: string; taskId: string }) => {
    await maybeRequireAuth();
    const { resetBacklog } = await import('./commands/backlog.js');
    await resetBacklog(options.chatroomId, options);
  });

backlogCommand
  .command('mark-for-review')
  .description('Mark a backlog task as ready for user review (backlog → pending_user_review)')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--task-id <taskId>', 'Task ID to mark for review')
  .action(async (options: { chatroomId: string; role: string; taskId: string }) => {
    await maybeRequireAuth();
    const { markForReviewBacklog } = await import('./commands/backlog.js');
    await markForReviewBacklog(options.chatroomId, options);
  });

// ============================================================================
// MESSAGES COMMANDS (auth required)
// ============================================================================

const messagesCommand = program
  .command('messages')
  .description('List and filter chatroom messages');

messagesCommand
  .command('list')
  .description('List messages by sender role or since a specific message')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .option('--sender-role <senderRole>', 'Filter by sender role (e.g., user, builder, reviewer)')
  .option('--since-message-id <messageId>', 'Get all messages since this message ID (inclusive)')
  .option('--limit <n>', 'Maximum number of messages to show')
  .option('--full', 'Show full message content without truncation')
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      senderRole?: string;
      sinceMessageId?: string;
      limit?: string;
      full?: boolean;
    }) => {
      // Validate: must specify either --sender-role or --since-message-id
      if (!options.senderRole && !options.sinceMessageId) {
        console.error('❌ Must specify either --sender-role or --since-message-id');
        console.error('   Examples:');
        console.error(
          '     chatroom messages list --chatroom-id=<id> --role=builder --sender-role=user --limit=3'
        );
        console.error(
          '     chatroom messages list --chatroom-id=<id> --role=builder --since-message-id=<msgId>'
        );
        process.exit(1);
      }

      await maybeRequireAuth();

      // Branch based on which option was provided
      if (options.senderRole) {
        const { listBySenderRole } = await import('./commands/messages.js');
        await listBySenderRole(options.chatroomId, {
          role: options.role,
          senderRole: options.senderRole,
          limit: options.limit ? parseInt(options.limit, 10) : 10,
          full: options.full,
        });
      } else if (options.sinceMessageId) {
        const { listSinceMessage } = await import('./commands/messages.js');
        await listSinceMessage(options.chatroomId, {
          role: options.role,
          sinceMessageId: options.sinceMessageId,
          limit: options.limit ? parseInt(options.limit, 10) : 100,
          full: options.full,
        });
      }
    }
  );

// ============================================================================
// CONTEXT COMMANDS (auth required)
// ============================================================================

const contextCommand = program
  .command('context')
  .description('Manage chatroom context and state (explicit context management)');

contextCommand
  .command('read')
  .description('Read context for your role (conversation history, tasks, status)')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .action(async (options: { chatroomId: string; role: string }) => {
    await maybeRequireAuth();
    const { readContext } = await import('./commands/context.js');
    await readContext(options.chatroomId, options);
  });

contextCommand
  .command('new')
  .description('Create a new context and pin it for all agents')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role (creator of the context)')
  .option(
    '--content <content>',
    'Context summary/description (alternative: provide via stdin/heredoc)'
  )
  .action(async (options: { chatroomId: string; role: string; content?: string }) => {
    await maybeRequireAuth();

    // Resolve content: flag takes priority, fall back to stdin/heredoc
    let content: string;
    if (options.content && options.content.trim().length > 0) {
      content = options.content.trim();
    } else {
      const stdinContent = await readStdin();
      if (!stdinContent.trim()) {
        console.error('❌ Context content cannot be empty.');
        console.error('   Provide content via --content="..." or stdin (heredoc):');
        console.error("   chatroom context new --chatroom-id=<id> --role=<role> << 'EOF'");
        console.error('   Your context summary here');
        console.error('   EOF');
        process.exit(1);
      }
      content = stdinContent.trim();
    }

    const { newContext } = await import('./commands/context.js');
    await newContext(options.chatroomId, { ...options, content });
  });

contextCommand
  .command('list')
  .description('List recent contexts for a chatroom')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .option('--limit <n>', 'Maximum number of contexts to show (default: 10)')
  .action(async (options: { chatroomId: string; role: string; limit?: string }) => {
    await maybeRequireAuth();
    const { listContexts } = await import('./commands/context.js');
    await listContexts(options.chatroomId, {
      role: options.role,
      limit: options.limit ? parseInt(options.limit, 10) : 10,
    });
  });

contextCommand
  .command('inspect')
  .description('View a specific context with staleness information')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--context-id <contextId>', 'Context ID to inspect')
  .action(async (options: { chatroomId: string; role: string; contextId: string }) => {
    await maybeRequireAuth();
    const { inspectContext } = await import('./commands/context.js');
    await inspectContext(options.chatroomId, options);
  });

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
  .command('create')
  .description('Create a new artifact from a file')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--from-file <path>', 'Path to file containing artifact content')
  .requiredOption('--filename <filename>', 'Display filename for the artifact')
  .option('--description <description>', 'Optional description of the artifact')
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      fromFile: string;
      filename: string;
      description?: string;
    }) => {
      await maybeRequireAuth();
      const { createArtifact } = await import('./commands/artifact.js');
      await createArtifact(options.chatroomId, options);
    }
  );

artifactCommand
  .command('view')
  .description('View a single artifact')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--artifact-id <id>', 'Artifact identifier')
  .requiredOption('--role <role>', 'Your role')
  .action(async (options: { chatroomId: string; artifactId: string; role: string }) => {
    await maybeRequireAuth();
    const { viewArtifact } = await import('./commands/artifact.js');
    await viewArtifact(options.chatroomId, { role: options.role, artifactId: options.artifactId });
  });

artifactCommand
  .command('view-many')
  .description('View multiple artifacts')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .option(
    '--artifact <artifactId>',
    'Artifact ID to view (can be used multiple times)',
    (value: string, previous: string[]) => {
      return previous ? [...previous, value] : [value];
    },
    []
  )
  .action(async (options: { chatroomId: string; role: string; artifact?: string[] }) => {
    await maybeRequireAuth();
    const { viewManyArtifacts } = await import('./commands/artifact.js');
    await viewManyArtifacts(options.chatroomId, {
      role: options.role,
      artifactIds: options.artifact || [],
    });
  });

// ============================================================================
// MACHINE COMMANDS (auth required)
// ============================================================================

const machineCommand = program
  .command('machine')
  .description('Machine daemon management for remote agent control');

const daemonCommand = machineCommand.command('daemon').description('Manage the machine daemon');

daemonCommand
  .command('start')
  .description('Start the machine daemon to listen for remote commands')
  .action(async () => {
    await maybeRequireAuth();
    const { daemonStart } = await import('./commands/machine/index.js');
    await daemonStart();
  });

daemonCommand
  .command('stop')
  .description('Stop the running machine daemon')
  .action(async () => {
    const { daemonStop } = await import('./commands/machine/index.js');
    await daemonStop();
  });

daemonCommand
  .command('status')
  .description('Check if the machine daemon is running')
  .action(async () => {
    const { daemonStatus } = await import('./commands/machine/index.js');
    await daemonStatus();
  });

// ============================================================================
// OPENCODE COMMANDS (no auth required)
// ============================================================================

const opencodeCommand = program.command('opencode').description('OpenCode integration harness');

opencodeCommand
  .command('install')
  .description('Install chatroom as an OpenCode harness')
  .option('--force', 'Overwrite existing harness installation')
  .action(async (options: { force?: boolean }) => {
    const { installTool } = await import('./commands/opencode-install.js');
    await installTool({ checkExisting: !options.force });
  });

program.parse();
