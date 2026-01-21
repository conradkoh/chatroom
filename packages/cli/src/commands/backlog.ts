/**
 * Backlog commands for managing task queue and backlog
 */

import { api, type Id } from '../api.js';
import { getSessionId } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

type TaskStatus = 'pending' | 'in_progress' | 'queued' | 'backlog' | 'completed' | 'cancelled';

interface Task {
  _id: string;
  content: string;
  status: TaskStatus;
  createdAt: number;
  queuePosition: number;
  assignedTo?: string;
}

interface TaskCounts {
  pending: number;
  in_progress: number;
  queued: number;
  backlog: number;
  completed: number;
  cancelled: number;
}

/**
 * List tasks in a chatroom
 */
export async function listBacklog(
  chatroomId: string,
  options: {
    role: string;
    status?: string;
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
    'in_progress',
    'queued',
    'backlog',
    'completed',
    'cancelled',
    'active',
    'all',
  ];
  const statusFilter = options.status || 'active';
  if (!validStatuses.includes(statusFilter)) {
    console.error(
      `❌ Invalid status: ${statusFilter}. Must be one of: ${validStatuses.join(', ')}`
    );
    process.exit(1);
  }

  try {
    // Get task counts
    const counts = (await client.query(api.tasks.getTaskCounts, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    })) as TaskCounts;

    // Get tasks with filter
    const tasks = (await client.query(api.tasks.listTasks, {
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
              | 'cancelled'
              | 'active'),
      limit: options.limit || 20,
    })) as Task[];

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

        // Use full content or truncate based on --full flag
        const displayContent = options.full ? task.content : truncate(task.content, 100);
        console.log(`#${i + 1} [${statusEmoji} ${task.status.toUpperCase()}] ${displayContent}`);
        console.log(`   ID: ${task._id}`);
        console.log(
          `   Created: ${date}${task.assignedTo ? ` | Assigned: ${task.assignedTo}` : ''}`
        );
        console.log('');
      }
    }

    console.log('──────────────────────────────────────────────────');
    console.log(`Showing ${tasks.length} task(s)`);
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

interface CompleteResult {
  success: boolean;
  taskId: string;
  promoted: string | null;
  wasForced: boolean;
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
    const result = (await client.mutation(api.tasks.completeTaskById, {
      sessionId,
      taskId: options.taskId as Id<'chatroom_tasks'>,
      force: options.force,
    })) as CompleteResult;

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

function getStatusEmoji(status: TaskStatus): string {
  switch (status) {
    case 'pending':
      return '🟢';
    case 'in_progress':
      return '🔵';
    case 'queued':
      return '🟡';
    case 'backlog':
      return '⚪';
    case 'completed':
      return '✅';
    case 'cancelled':
      return '❌';
    default:
      return '⚫';
  }
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
