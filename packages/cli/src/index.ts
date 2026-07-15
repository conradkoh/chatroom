#!/usr/bin/env node
/**
 * Chatroom CLI
 *
 * CLI for multi-agent chatroom collaboration.
 * Run `chatroom --help` for usage information.
 */

import { Command } from 'commander';

import { registerChatroomRoleCommand } from './commands/register-chatroom-role-command.js';
import { collectMultiValueOption } from './utils/multi-value-option.js';
import { readHeredocOrFileContent } from './utils/read-heredoc-or-file-content.js';
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
    const { authLogin } = await import('./commands/auth-login/index.js');
    await authLogin(options);
  });

authCommand
  .command('logout')
  .description('Clear CLI authentication')
  .action(async () => {
    const { authLogout } = await import('./commands/auth-logout/index.js');
    await authLogout();
  });

authCommand
  .command('status')
  .description('Show current authentication status')
  .action(async () => {
    const { authStatus } = await import('./commands/auth-status/index.js');
    await authStatus();
  });

// ============================================================================
// UPDATE COMMAND (no auth required)
// ============================================================================

program
  .command('update')
  .description('Update the CLI to the latest version')
  .action(async () => {
    const { update } = await import('./commands/update/index.js');
    await update();
  });

// ============================================================================
// USER COMMANDS (no auth required)
// ============================================================================

program
  .command('init')
  .description('Initialize chatroom integration in your project')
  .option('--dir <path>', 'Directory to initialize (default: current directory)')
  .action(async (options: { dir?: string }) => {
    const { init } = await import('./commands/init/index.js');
    await init({ dir: options.dir });
  });

// ============================================================================
// TOOL COMMANDS (no auth required — agents run tools locally)
// ============================================================================

const toolCommand = program.command('tool').description('Built-in tools for agent workflows');

toolCommand
  .command('parse-pdf')
  .description('Parse a PDF file and extract text content to a temp file')
  .requiredOption('--input <path-or-url>', 'PDF file path or URL')
  .option('--working-dir <dir>', 'Working directory for output', process.cwd())
  .action(async (options: { input: string; workingDir: string }) => {
    const { parsePdf } = await import('./tools/parse-pdf/index.js');
    const result = await parsePdf(options.input, options.workingDir);
    console.log(result.message);
    process.exit(result.success ? 0 : 1);
  });

// ============================================================================
// CHATROOM COMMANDS (auth required unless --skip-auth)
// ============================================================================

program
  .command('register-agent')
  .description('Register agent type for a chatroom role')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Role to register as (e.g., builder, planner)')
  .requiredOption('--type <type>', 'Agent type: remote or custom')
  .option(
    '--allow-type-change',
    'Required for --type=custom when the role is currently bound to a remote machine; explicitly opts into clearing the existing binding.'
  )
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      type: string;
      allowTypeChange?: boolean;
    }) => {
      await maybeRequireAuth();

      // Validate type
      if (options.type !== 'remote' && options.type !== 'custom') {
        console.error(`❌ Invalid agent type: "${options.type}". Must be "remote" or "custom".`);
        process.exit(1);
      }

      const { registerAgent } = await import('./commands/register-agent/index.js');
      await registerAgent(options.chatroomId, {
        role: options.role,
        type: options.type as 'remote' | 'custom',
        allowTypeChange: options.allowTypeChange,
      });
    }
  );

program
  .command('get-next-task')
  .description('Join a chatroom and get the next task')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Role to join as (e.g., builder, planner)')
  .action(async (options: { chatroomId: string; role: string }) => {
    await maybeRequireAuth();
    const { getNextTask } = await import('./commands/get-next-task/index.js');

    await getNextTask(options.chatroomId, {
      role: options.role,
    });
  });

const handoffCommandGroup = program
  .command('handoff')
  .description('Complete your task and hand off to the next role');

handoffCommandGroup
  .command('view-template')
  .description('Print the handoff message template for a role pair')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--next-role <nextRole>', 'Target role for the handoff')
  .option('--team-id <teamId>', 'Team id (solo, duo); defaults to duo')
  .action(async (options: { role: string; nextRole: string; teamId?: string }) => {
    const { printHandoffViewTemplate } = await import('./commands/handoff/view-template.js');
    try {
      printHandoffViewTemplate(options);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

handoffCommandGroup
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--next-role <nextRole>', 'Role to hand off to')
  .action(async (options: { chatroomId: string; role: string; nextRole: string }) => {
    await maybeRequireAuth();

    // Read message from stdin
    const { decode } = await import('./utils/serialization/decode/index.js');
    const stdinContent = await readStdin();

    let message: string;
    try {
      const { HANDOFF_STDIN_DELIMITER, validateStdinHeredocBody } =
        await import('@workspace/backend/prompts/cli/stdin-heredoc.js');
      const result = decode(stdinContent, { singleParam: 'message' });
      message = result.message;
      validateStdinHeredocBody(message, HANDOFF_STDIN_DELIMITER);
    } catch (err) {
      console.error(`❌ Failed to decode stdin: ${(err as Error).message}`);
      process.exit(1);
    }

    // Validate that message is not empty
    if (!message || message.trim().length === 0) {
      console.error('❌ Message is empty');
      process.exit(1);
    }

    const { handoff } = await import('./commands/handoff/index.js');
    await handoff(options.chatroomId, {
      role: options.role,
      message,
      nextRole: options.nextRole,
    });
  });

const agenticQueryCommand = program
  .command('agentic-query')
  .description('Complete an agentic search/ask query from the workspace agent');

agenticQueryCommand
  .command('complete')
  .description('Submit the structured agentic query result markdown')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--query-id <id>', 'Agentic query identifier')
  .requiredOption('--role <role>', 'Your role (workspace-agent)')
  .action(async (options: { chatroomId: string; queryId: string; role: string }) => {
    await maybeRequireAuth();

    const { decode } = await import('./utils/serialization/decode/index.js');
    const stdinContent = await readStdin();

    let result: string;
    try {
      const { AGENTIC_QUERY_STDIN_DELIMITER, validateStdinHeredocBody } =
        await import('@workspace/backend/prompts/cli/stdin-heredoc.js');
      const decoded = decode(stdinContent, { singleParam: 'message' });
      result = decoded.message;
      validateStdinHeredocBody(result, AGENTIC_QUERY_STDIN_DELIMITER);
    } catch (err) {
      console.error(`❌ Failed to decode stdin: ${(err as Error).message}`);
      process.exit(1);
    }

    if (!result?.trim()) {
      console.error('❌ Result body is empty');
      process.exit(1);
    }

    const { agenticQueryComplete } = await import('./commands/agentic-query/complete.js');
    await agenticQueryComplete(options.chatroomId, {
      queryId: options.queryId,
      result,
    });
  });

// ============================================================================
// BACKLOG COMMANDS (auth required)
// ============================================================================

const backlogCommand = program.command('backlog').description('Manage task queue and backlog');

backlogCommand
  .command('list')
  .description('List backlog items')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .option('--limit <n>', 'Maximum number of items to show')
  .option('--sort <sort>', 'Sort order: date:desc (default) | priority:desc')
  .option('--filter <filter>', 'Filter: unscored (only items without priority score)')
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      limit?: string;
      sort?: string;
      filter?: string;
    }) => {
      await maybeRequireAuth();
      const { listBacklog } = await import('./commands/backlog/index.js');
      await listBacklog(options.chatroomId, {
        role: options.role,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
        sort: options.sort as 'date:desc' | 'priority:desc' | undefined,
        filter: options.filter as 'unscored' | undefined,
      });
    }
  );

backlogCommand
  .command('add')
  .description('Add a backlog item')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role (creator)')
  .option('--content-file <path>', 'Path to file containing task content (or use stdin/heredoc)')
  .action(async (options: { chatroomId: string; role: string; contentFile?: string }) => {
    await maybeRequireAuth();

    let content: string;
    try {
      content = await readHeredocOrFileContent(options, {
        delimiter: (await import('@workspace/backend/prompts/cli/stdin-heredoc.js'))
          .BACKLOG_STDIN_DELIMITER,
        fieldLabel: 'Content',
        emptyMessage: 'Content is empty. Provide content via --content-file or stdin (heredoc).',
        heredocExampleCommand:
          "chatroom backlog add --chatroom-id=<id> --role=<role> << 'CHATROOM_BACKLOG_END'",
      });
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }

    const { addBacklog } = await import('./commands/backlog/index.js');
    await addBacklog(options.chatroomId, { role: options.role, content });
  });

backlogCommand
  .command('update')
  .description('Update the content of an existing backlog item.')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--backlog-item-id <id>', 'Backlog item ID to update')
  .option('--content-file <path>', 'Path to file containing new content (or use stdin/heredoc)')
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      backlogItemId: string;
      contentFile?: string;
    }) => {
      await maybeRequireAuth();

      let content: string;
      try {
        content = await readHeredocOrFileContent(options, {
          delimiter: (await import('@workspace/backend/prompts/cli/stdin-heredoc.js'))
            .BACKLOG_STDIN_DELIMITER,
          fieldLabel: 'Content',
          emptyMessage: 'Content is empty. Provide content via --content-file or stdin (heredoc).',
          heredocExampleCommand:
            "chatroom backlog update --chatroom-id=<id> --role=<role> --backlog-item-id=<id> << 'CHATROOM_BACKLOG_END'",
        });
      } catch (err) {
        console.error(`❌ ${(err as Error).message}`);
        process.exit(1);
      }

      const { updateBacklog } = await import('./commands/backlog/index.js');
      await updateBacklog(options.chatroomId, {
        role: options.role,
        backlogItemId: options.backlogItemId,
        content,
      });
    }
  );

backlogCommand
  .command('complete')
  .description('Mark a backlog item as complete. Use --force for stuck in_progress/pending tasks.')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--backlog-item-id <id>', 'Backlog item ID to complete')
  .option('-f, --force', 'Force complete a stuck in_progress or pending task')
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      backlogItemId: string;
      force?: boolean;
    }) => {
      await maybeRequireAuth();
      const { completeBacklog } = await import('./commands/backlog/index.js');
      await completeBacklog(options.chatroomId, options);
    }
  );

backlogCommand
  .command('reopen')
  .description('Reopen a closed backlog item, returning it to backlog status.')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--backlog-item-id <id>', 'Backlog item ID to reopen')
  .action(async (options: { chatroomId: string; role: string; backlogItemId: string }) => {
    await maybeRequireAuth();
    const { reopenBacklog } = await import('./commands/backlog/index.js');
    await reopenBacklog(options.chatroomId, options);
  });

backlogCommand
  .command('score')
  .description('Score a backlog item by complexity, value, and priority')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--backlog-item-id <id>', 'Backlog item ID to score')
  .option('--complexity <level>', 'Complexity level: low, medium, high')
  .option('--value <level>', 'Value level: low, medium, high')
  .option('--priority <n>', 'Priority number (higher = more important)')
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      backlogItemId: string;
      complexity?: string;
      value?: string;
      priority?: string;
    }) => {
      await maybeRequireAuth();
      const { scoreBacklog } = await import('./commands/backlog/index.js');
      await scoreBacklog(options.chatroomId, options);
    }
  );

backlogCommand
  .command('mark-for-review')
  .description('Mark a backlog item as ready for user review (backlog → pending_user_review)')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--backlog-item-id <id>', 'Backlog item ID to mark for review')
  .action(async (options: { chatroomId: string; role: string; backlogItemId: string }) => {
    await maybeRequireAuth();
    const { markForReviewBacklog } = await import('./commands/backlog/index.js');
    await markForReviewBacklog(options.chatroomId, options);
  });

backlogCommand
  .command('history')
  .description('View completed and closed backlog items by date range (all statuses)')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .option('--from <date>', 'Start date (YYYY-MM-DD), defaults to 30 days ago')
  .option('--to <date>', 'End date (YYYY-MM-DD), defaults to today')
  .option('--limit <n>', 'Maximum number of items to show')
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      from?: string;
      to?: string;
      limit?: string;
    }) => {
      await maybeRequireAuth();
      const { historyBacklog } = await import('./commands/backlog/index.js');
      await historyBacklog(options.chatroomId, {
        role: options.role,
        from: options.from,
        to: options.to,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });
    }
  );

backlogCommand
  .command('close')
  .description('Close a backlog item (mark as stale/superseded)')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .requiredOption('--backlog-item-id <id>', 'Backlog item ID to close')
  .requiredOption('--reason <text>', 'Reason for closing (required for audit trail)')
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      backlogItemId: string;
      reason: string;
    }) => {
      await maybeRequireAuth();
      const { closeBacklog } = await import('./commands/backlog/index.js');
      await closeBacklog(options.chatroomId, options);
    }
  );

backlogCommand
  .command('export')
  .description('Export backlog items to a JSON file')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .option('--path <path>', 'Directory path to export to (default: .chatroom/exports/)')
  .action(async (options: { chatroomId: string; role: string; path?: string }) => {
    await maybeRequireAuth();
    const { exportBacklog } = await import('./commands/backlog/index.js');
    await exportBacklog(options.chatroomId, { role: options.role, path: options.path });
  });

backlogCommand
  .command('import')
  .description('Import backlog items from a JSON export file')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .option('--path <path>', 'Directory path to import from (default: .chatroom/exports/)')
  .action(async (options: { chatroomId: string; role: string; path?: string }) => {
    await maybeRequireAuth();
    const { importBacklog } = await import('./commands/backlog/index.js');
    await importBacklog(options.chatroomId, { role: options.role, path: options.path });
  });

// ============================================================================
// TASK COMMANDS (auth required)
// ============================================================================

const taskCommand = program.command('task').description('Manage tasks');

taskCommand
  .command('read')
  .description('Read task details (optional recovery; harness output marks tasks in_progress)')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role in the chatroom')
  .requiredOption('--task-id <taskId>', 'Task ID to read')
  .action(async (options: { chatroomId: string; role: string; taskId: string }) => {
    await maybeRequireAuth();
    const { taskRead } = await import('./commands/task/read/index.js');
    await taskRead(options.chatroomId, { role: options.role, taskId: options.taskId });
  });

// ============================================================================
// SKILL COMMANDS (auth required)
// ============================================================================

const skillCommand = program.command('skill').description('Manage and activate chatroom skills');

skillCommand
  .command('list')
  .description('List available skills for a chatroom')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .action(async (options: { chatroomId: string; role: string }) => {
    await maybeRequireAuth();
    const { listSkills } = await import('./commands/skill/index.js');
    await listSkills(options.chatroomId, { role: options.role });
  });

skillCommand
  .command('activate <skill-name>')
  .description('Activate a named skill in the chatroom')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .action(async (skillName: string, options: { chatroomId: string; role: string }) => {
    await maybeRequireAuth();
    const { activateSkill } = await import('./commands/skill/index.js');
    await activateSkill(options.chatroomId, skillName, { role: options.role });
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
  .option('--sender-role <senderRole>', 'Filter by sender role (e.g., user, builder, planner)')
  .option('--since-message-id <messageId>', 'Get all messages since this message ID (inclusive)')
  .option('--limit <n>', 'Maximum number of messages to show')
  .option('--full', 'Show full message content without truncation')
  // fallow-ignore-next-line complexity
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
        const { listBySenderRole } = await import('./commands/messages/index.js');
        await listBySenderRole(options.chatroomId, {
          role: options.role,
          senderRole: options.senderRole,
          limit: options.limit ? parseInt(options.limit, 10) : 10,
          full: options.full,
        });
      } else if (options.sinceMessageId) {
        const { listSinceMessage } = await import('./commands/messages/index.js');
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
    const { readContext } = await import('./commands/context/index.js');
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
  .option(
    '--trigger-message-id <messageId>',
    'Message ID that triggered this context (anchors the context window)'
  )
  .action(
    async (options: {
      chatroomId: string;
      role: string;
      content?: string;
      triggerMessageId?: string;
    }) => {
      await maybeRequireAuth();

      // Resolve content: flag takes priority, fall back to stdin/heredoc
      let content: string;
      if (options.content && options.content.trim().length > 0) {
        content = options.content.trim();
      } else {
        const stdinContent = await readStdin();
        const { CONTEXT_STDIN_DELIMITER, validateStdinHeredocBody } =
          await import('@workspace/backend/prompts/cli/stdin-heredoc.js');
        if (!stdinContent.trim()) {
          console.error('❌ Context content cannot be empty.');
          console.error('   Provide content via --content="..." or stdin (heredoc):');
          console.error(
            "   chatroom context new --chatroom-id=<id> --role=<role> << 'CHATROOM_CONTEXT_END'"
          );
          console.error('   Your context summary here');
          console.error('   CHATROOM_CONTEXT_END');
          process.exit(1);
        }
        try {
          validateStdinHeredocBody(stdinContent, CONTEXT_STDIN_DELIMITER, 'Context');
        } catch (err) {
          console.error(`❌ ${(err as Error).message}`);
          process.exit(1);
        }
        content = stdinContent.trim();
      }

      const { newContext } = await import('./commands/context/index.js');
      await newContext(options.chatroomId, { ...options, content });
    }
  );

contextCommand
  .command('list')
  .description('List recent contexts for a chatroom')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Your role')
  .option('--limit <n>', 'Maximum number of contexts to show (default: 10)')
  .action(async (options: { chatroomId: string; role: string; limit?: string }) => {
    await maybeRequireAuth();
    const { listContexts } = await import('./commands/context/index.js');
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
    const { inspectContext } = await import('./commands/context/index.js');
    await inspectContext(options.chatroomId, options);
  });

contextCommand
  .command('view-template')
  .description('Print a template for `chatroom context new` content.')
  .option('--chatroom-id <id>', 'Ignored (accepted for copy-paste compatibility)')
  .option('--role <role>', 'Ignored (accepted for copy-paste compatibility)')
  .action(async () => {
    const { viewTemplate } = await import('./commands/context/index.js');
    console.log(viewTemplate());
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
    const { viewGuidelines } = await import('./commands/guidelines/index.js');
    await viewGuidelines(options);
  });

guidelinesCommand
  .command('list')
  .description('List available guideline types')
  .action(async () => {
    await maybeRequireAuth();
    const { listGuidelineTypes } = await import('./commands/guidelines/index.js');
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
      const { createArtifact } = await import('./commands/artifact/index.js');
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
    const { viewArtifact } = await import('./commands/artifact/index.js');
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
    collectMultiValueOption,
    []
  )
  .action(async (options: { chatroomId: string; role: string; artifact?: string[] }) => {
    await maybeRequireAuth();
    const { viewManyArtifacts } = await import('./commands/artifact/index.js');
    await viewManyArtifacts(options.chatroomId, {
      role: options.role,
      artifactIds: options.artifact || [],
    });
  });

// ============================================================================
// FILE COMMANDS (auth required)
// ============================================================================

registerChatroomRoleCommand(program, {
  name: 'get-system-prompt',
  description: 'Fetch the system prompt for your role in a chatroom',
  maybeRequireAuth,
  run: async (chatroomId, { role }) => {
    const { getSystemPrompt } = await import('./commands/get-system-prompt/index.js');
    await getSystemPrompt(chatroomId, { role });
  },
});

registerChatroomRoleCommand(program, {
  name: 'get-role-guidance',
  description: 'Fetch role-specific operating-model guidance for your role in a chatroom',
  maybeRequireAuth,
  run: async (chatroomId, { role }) => {
    const { getRoleGuidance } = await import('./commands/get-role-guidance/index.js');
    await getRoleGuidance(chatroomId, { role });
  },
});

// ============================================================================
// TELEGRAM COMMANDS (auth required)
// ============================================================================

const telegramCommand = program.command('telegram').description('Telegram integration commands');

telegramCommand
  .command('send-message')
  .description('Send a message to a connected Telegram integration')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--integration-id <id>', 'Telegram integration ID')
  .requiredOption('--message <text>', 'Message to send')
  .option('--role <role>', 'Sender role label (default: user)')
  .action(
    async (options: {
      chatroomId: string;
      integrationId: string;
      message: string;
      role?: string;
    }) => {
      await maybeRequireAuth();
      const { sendMessage } = await import('./commands/telegram/index.js');
      await sendMessage(options);
    }
  );

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
    // NOTE: do NOT call maybeRequireAuth() here.
    // initDaemon() inside daemonStart() already handles local auth validation
    // (validateAuthentication) and the init retry loop handles backend connectivity.
    // Pre-flight requireAuth() makes a network call and exits on failure, which
    // causes pm2 to restart the daemon in a tight loop when the backend is down.
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

const harnessCommand = machineCommand.command('harness').description('Manage agent harnesses');

harnessCommand
  .command('status')
  .description('List all registered harnesses and their detection status on this machine')
  .action(async () => {
    const { harnessStatus } = await import('./commands/machine/index.js');
    await harnessStatus();
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
    const { installTool } = await import('./commands/opencode-install/index.js');
    await installTool({ checkExisting: !options.force });
  });
// Centralized lifecycle heartbeat — fires before every chatroom-aware command.
// This replaces the per-handler sendLifecycleHeartbeat calls and also covers
// commands like `messages list` and `backlog` that previously had no coverage.
program.hook('preAction', async (_thisCommand, actionCommand) => {
  const opts = actionCommand.opts();
  const chatroomId = opts['chatroomId'] as string | undefined;
  const role = opts['role'] as string | undefined;
  if (!chatroomId || !role) return;

  // Lazily import to avoid circular deps at module load time
  const { getSessionId } = await import('./infrastructure/auth/storage.js');
  const { getConvexClient } = await import('./infrastructure/convex/client.js');
  const { sendLifecycleHeartbeat } = await import('./infrastructure/lifecycle-heartbeat.js');

  const sessionId = await getSessionId();
  if (!sessionId) return; // not authed yet — skip silently

  const client = await getConvexClient();
  // Presence-only heartbeat — omit action so join skips no-op lastSeenAction patches.
  sendLifecycleHeartbeat(client, { sessionId, chatroomId, role });
});

program.parse();
