/**
 * Backlog commands for managing task queue and backlog
 */

import { api, type Id } from '../../api.js';
import { getSessionId } from '../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../infrastructure/convex/client.js';

type TaskStatus =
  | 'pending'
  | 'acknowledged'
  | 'in_progress'
  | 'queued'
  | 'backlog'
  | 'backlog_acknowledged'
  | 'completed'
  | 'pending_user_review'
  | 'closed';

/**
 * List tasks in a chatroom
 */
export async function listBacklog(
  chatroomId: string,
  options: {
    role: string;
    status: string;
    limit?: number;
    full?: boolean;
  }
): Promise<void> {
  const client = await getConvexClient();

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    console.error(
      `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`
    );
    process.exit(1);
  }

  // Validate status filter
  const validStatuses = [
    'pending',
    'acknowledged',
    'in_progress',
    'queued',
    'backlog',
    'backlog_acknowledged',
    'completed',
    'closed',
    'active',
    'pending_review', // tasks awaiting user review
    'archived', // completed + closed
    'all',
  ];
  const statusFilter = options.status;
  if (!statusFilter || !validStatuses.includes(statusFilter)) {
    console.error(
      `❌ Invalid or missing status: ${statusFilter || '(none)'}. Must be one of: ${validStatuses.join(', ')}`
    );
    process.exit(1);
  }

  try {
    // Get task counts
    const counts = await client.query(api.tasks.getTaskCounts, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    });

    // Get tasks with filter - use specific queries for active/archived
    let tasks;
    if (statusFilter === 'active') {
      tasks = await client.query(api.tasks.listActiveTasks, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        limit: options.limit || 100,
      });
    } else if (statusFilter === 'archived') {
      tasks = await client.query(api.tasks.listArchivedTasks, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        limit: options.limit || 100,
      });
    } else {
      // For specific status filters or 'all', use original listTasks
      tasks = await client.query(api.tasks.listTasks, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        statusFilter:
          statusFilter === 'all'
            ? undefined
            : (statusFilter as
                | 'pending'
                | 'in_progress'
                | 'queued'
                | 'backlog'
                | 'completed'
                | 'pending_user_review'
                | 'closed'
                | 'active'
                | 'pending_review'
                | 'archived'),
        limit: options.limit || 100,
      });
    }

    // Display header
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('📋 TASK QUEUE');
    console.log('══════════════════════════════════════════════════');
    console.log(`Chatroom: ${chatroomId}`);
    console.log(`Filter: ${statusFilter}`);
    console.log('');

    // Display counts summary
    console.log('──────────────────────────────────────────────────');
    console.log('📊 SUMMARY');
    console.log('──────────────────────────────────────────────────');
    if (counts.pending > 0) console.log(`  🟢 Pending: ${counts.pending}`);
    if (counts.in_progress > 0) console.log(`  🔵 In Progress: ${counts.in_progress}`);
    if (counts.queued > 0) console.log(`  🟡 Queued: ${counts.queued}`);
    if (counts.backlog > 0) console.log(`  ⚪ Backlog: ${counts.backlog}`);
    const activeTotal = counts.pending + counts.in_progress + counts.queued + counts.backlog;
    console.log(`  📝 Active Total: ${activeTotal}/100`);
    console.log('');

    // Display tasks
    if (tasks.length === 0) {
      console.log('No tasks found.');
    } else {
      console.log('──────────────────────────────────────────────────');
      console.log('📝 TASKS');
      console.log('──────────────────────────────────────────────────');

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i]!;
        const statusEmoji = getStatusEmoji(task.status);
        const date = new Date(task.createdAt).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });

        // Show full content by default (--full flag kept for backward compatibility)
        const displayContent = task.content;
        console.log(`#${i + 1} [${statusEmoji} ${task.status.toUpperCase()}] ${displayContent}`);
        console.log(`   ID: ${task._id}`);
        console.log(
          `   Created: ${date}${task.assignedTo ? ` | Assigned: ${task.assignedTo}` : ''}`
        );
        console.log('');
      }
    }

    console.log('──────────────────────────────────────────────────');
    // Calculate total tasks for the current filter to show truncation info
    let totalForFilter: number;
    if (statusFilter === 'all') {
      totalForFilter =
        counts.pending +
        counts.in_progress +
        counts.queued +
        counts.backlog +
        counts.pending_user_review +
        counts.completed +
        counts.closed;
    } else if (statusFilter === 'active') {
      totalForFilter = counts.pending + counts.in_progress + counts.queued + counts.backlog;
    } else if (statusFilter === 'archived') {
      totalForFilter = counts.completed + counts.closed;
    } else if (statusFilter === 'pending_review') {
      // pending_review is separate, use tasks.length as best estimate
      totalForFilter = tasks.length;
    } else {
      totalForFilter = counts[statusFilter as keyof typeof counts] ?? tasks.length;
    }

    if (tasks.length < totalForFilter) {
      console.log(
        `Showing ${tasks.length} of ${totalForFilter} task(s) (use --limit=N to see more)`
      );
    } else {
      console.log(`Showing ${tasks.length} task(s)`);
    }
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to list tasks: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Add a task to the backlog
 */
export async function addBacklog(
  chatroomId: string,
  options: {
    role: string;
    content: string;
  }
): Promise<void> {
  const client = await getConvexClient();

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    console.error(
      `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`
    );
    process.exit(1);
  }

  // Validate content
  if (!options.content || options.content.trim().length === 0) {
    console.error(`❌ Task content cannot be empty`);
    process.exit(1);
  }

  try {
    const result = await client.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      content: options.content.trim(),
      createdBy: options.role,
      isBacklog: true,
    });

    console.log('');
    console.log('✅ Task added to backlog');
    console.log(`   ID: ${result.taskId}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Position: ${result.queuePosition}`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to add task: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Complete a backlog task by ID.
 * Use --force to complete stuck in_progress or pending tasks.
 */
export async function completeBacklog(
  chatroomId: string,
  options: {
    role: string;
    taskId: string;
    force?: boolean;
  }
): Promise<void> {
  const client = await getConvexClient();

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    console.error(
      `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`
    );
    process.exit(1);
  }

  // Validate task ID
  if (!options.taskId || options.taskId.trim().length === 0) {
    console.error(`❌ Task ID is required`);
    process.exit(1);
  }

  try {
    const result = await client.mutation(api.tasks.completeTaskById, {
      sessionId,
      taskId: options.taskId as Id<'chatroom_tasks'>,
      force: options.force,
    });

    console.log('');
    if (result.wasForced) {
      console.log('⚠️  Task force-completed (was in_progress or pending)');
    } else {
      console.log('✅ Task completed');
    }
    console.log(`   ID: ${options.taskId}`);

    if (result.promoted) {
      console.log(`   📤 Next task promoted: ${result.promoted}`);
      console.log('');
      console.log('💡 The next queued task is now pending and ready for processing.');
    }
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to complete task: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Reopen a completed backlog task, returning it to pending_user_review status.
 */
export async function reopenBacklog(
  chatroomId: string,
  options: {
    role: string;
    taskId: string;
  }
): Promise<void> {
  const client = await getConvexClient();

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    console.error(
      `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`
    );
    process.exit(1);
  }

  // Validate task ID
  if (!options.taskId || options.taskId.trim().length === 0) {
    console.error(`❌ Task ID is required`);
    process.exit(1);
  }

  try {
    await client.mutation(api.tasks.reopenBacklogTask, {
      sessionId,
      taskId: options.taskId as Id<'chatroom_tasks'>,
    });

    console.log('');
    console.log('✅ Task reopened');
    console.log(`   ID: ${options.taskId}`);
    console.log(`   Status: pending_user_review`);
    console.log('');
    console.log('💡 The task is now ready for user review again.');
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to reopen task: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Patch a task's scoring fields (complexity, value, priority).
 * Idempotent - can be called multiple times with same or different values.
 */
export async function patchBacklog(
  chatroomId: string,
  options: {
    role: string;
    taskId: string;
    complexity?: string;
    value?: string;
    priority?: string;
  }
): Promise<void> {
  const client = await getConvexClient();

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    console.error(
      `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`
    );
    process.exit(1);
  }

  // Validate task ID
  if (!options.taskId || options.taskId.trim().length === 0) {
    console.error(`❌ Task ID is required`);
    process.exit(1);
  }

  // Validate at least one field is provided
  if (
    options.complexity === undefined &&
    options.value === undefined &&
    options.priority === undefined
  ) {
    console.error(`❌ At least one of --complexity, --value, or --priority is required`);
    process.exit(1);
  }

  // Validate complexity if provided
  const validComplexity = ['low', 'medium', 'high'];
  if (options.complexity !== undefined && !validComplexity.includes(options.complexity)) {
    console.error(
      `❌ Invalid complexity: ${options.complexity}. Must be one of: ${validComplexity.join(', ')}`
    );
    process.exit(1);
  }

  // Validate value if provided
  const validValue = ['low', 'medium', 'high'];
  if (options.value !== undefined && !validValue.includes(options.value)) {
    console.error(`❌ Invalid value: ${options.value}. Must be one of: ${validValue.join(', ')}`);
    process.exit(1);
  }

  // Parse and validate priority if provided
  let priorityNum: number | undefined;
  if (options.priority !== undefined) {
    priorityNum = parseInt(options.priority, 10);
    if (isNaN(priorityNum)) {
      console.error(`❌ Invalid priority: ${options.priority}. Must be a number.`);
      process.exit(1);
    }
  }

  try {
    await client.mutation(api.tasks.patchTask, {
      sessionId,
      taskId: options.taskId as Id<'chatroom_tasks'>,
      complexity: options.complexity as 'low' | 'medium' | 'high' | undefined,
      value: options.value as 'low' | 'medium' | 'high' | undefined,
      priority: priorityNum,
    });

    console.log('');
    console.log('✅ Task updated');
    console.log(`   ID: ${options.taskId}`);
    if (options.complexity !== undefined) {
      console.log(`   Complexity: ${options.complexity}`);
    }
    if (options.value !== undefined) {
      console.log(`   Value: ${options.value}`);
    }
    if (priorityNum !== undefined) {
      console.log(`   Priority: ${priorityNum}`);
    }
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to patch task: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Score a backlog task by complexity, value, and priority.
 * This is a more user-friendly alias for patchBacklog focused on scoring.
 */
export async function scoreBacklog(
  chatroomId: string,
  options: {
    role: string;
    taskId: string;
    complexity?: string;
    value?: string;
    priority?: string;
  }
): Promise<void> {
  const client = await getConvexClient();

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    console.error(
      `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`
    );
    process.exit(1);
  }

  // Validate task ID
  if (!options.taskId || options.taskId.trim().length === 0) {
    console.error(`❌ Task ID is required`);
    process.exit(1);
  }

  // Validate at least one scoring field is provided
  if (
    options.complexity === undefined &&
    options.value === undefined &&
    options.priority === undefined
  ) {
    console.error(`❌ At least one of --complexity, --value, or --priority is required`);
    console.error(
      `   Example: chatroom backlog score --task-id=... --complexity=medium --value=high`
    );
    process.exit(1);
  }

  // Validate complexity if provided
  const validComplexity = ['low', 'medium', 'high'];
  if (options.complexity !== undefined && !validComplexity.includes(options.complexity)) {
    console.error(
      `❌ Invalid complexity: ${options.complexity}. Must be one of: ${validComplexity.join(', ')}`
    );
    process.exit(1);
  }

  // Validate value if provided
  const validValue = ['low', 'medium', 'high'];
  if (options.value !== undefined && !validValue.includes(options.value)) {
    console.error(`❌ Invalid value: ${options.value}. Must be one of: ${validValue.join(', ')}`);
    process.exit(1);
  }

  // Parse and validate priority if provided
  let priorityNum: number | undefined;
  if (options.priority !== undefined) {
    priorityNum = parseInt(options.priority, 10);
    if (isNaN(priorityNum)) {
      console.error(`❌ Invalid priority: ${options.priority}. Must be a number.`);
      process.exit(1);
    }
  }

  try {
    await client.mutation(api.tasks.patchTask, {
      sessionId,
      taskId: options.taskId as Id<'chatroom_tasks'>,
      complexity: options.complexity as 'low' | 'medium' | 'high' | undefined,
      value: options.value as 'low' | 'medium' | 'high' | undefined,
      priority: priorityNum,
    });

    console.log('');
    console.log('✅ Task scored');
    console.log(`   ID: ${options.taskId}`);
    if (options.complexity !== undefined) {
      console.log(`   Complexity: ${options.complexity}`);
    }
    if (options.value !== undefined) {
      console.log(`   Value: ${options.value}`);
    }
    if (priorityNum !== undefined) {
      console.log(`   Priority: ${priorityNum}`);
    }
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to score task: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Mark a backlog task as ready for user review.
 * Transitions the task from 'backlog' to 'pending_user_review'.
 */
export async function markForReviewBacklog(
  chatroomId: string,
  options: {
    role: string;
    taskId: string;
  }
): Promise<void> {
  const client = await getConvexClient();

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    console.error(
      `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`
    );
    process.exit(1);
  }

  // Validate task ID
  if (!options.taskId || options.taskId.trim().length === 0) {
    console.error(`❌ Task ID is required`);
    process.exit(1);
  }

  try {
    await client.mutation(api.tasks.markBacklogForReview, {
      sessionId,
      taskId: options.taskId as Id<'chatroom_tasks'>,
    });

    console.log('');
    console.log('✅ Task marked for review');
    console.log(`   ID: ${options.taskId}`);
    console.log(`   Status: pending_user_review`);
    console.log('');
    console.log(
      '💡 The task is now visible in the "Pending Review" section for user confirmation.'
    );
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to mark task for review: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Reset a stuck in_progress task back to pending.
 */
export async function resetBacklog(
  chatroomId: string,
  options: {
    role: string;
    taskId: string;
  }
): Promise<void> {
  const client = await getConvexClient();

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  try {
    const result = await client.mutation(api.tasks.resetStuckTask, {
      sessionId,
      taskId: options.taskId as Id<'chatroom_tasks'>,
    });

    console.log('');
    console.log('✅ Task reset to pending');
    console.log(`   ID: ${options.taskId}`);
    if (result.previousAssignee) {
      console.log(`   Previous assignee: ${result.previousAssignee}`);
    }
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to reset task: ${(error as Error).message}`);
    process.exit(1);
  }
}

function getStatusEmoji(status: TaskStatus): string {
  switch (status) {
    case 'pending':
      return '🟢';
    case 'acknowledged':
      return '📬';
    case 'in_progress':
      return '🔵';
    case 'queued':
      return '🟡';
    case 'backlog':
      return '⚪';
    case 'backlog_acknowledged':
      return '📋';
    case 'completed':
      return '✅';
    case 'pending_user_review':
      return '👀';
    case 'closed':
      return '🔒';
    default:
      return '⚫';
  }
}
