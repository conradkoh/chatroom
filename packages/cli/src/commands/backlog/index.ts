/**
 * Backlog commands for managing task queue and backlog
 */

import type { BacklogDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';

// ─── Re-exports ────────────────────────────────────────────────────────────

export type { BacklogDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

type TaskStatus =
  | 'pending'
  | 'acknowledged'
  | 'in_progress'
  | 'pending_user_review'
  | 'completed'
  | 'closed';

type BacklogItemStatus = 'backlog' | 'pending_user_review' | 'closed';

export interface ListBacklogOptions {
  role: string;
  limit?: number;
}

export interface AddBacklogOptions {
  role: string;
  content: string;
}

export interface CompleteBacklogOptions {
  role: string;
  taskId: string;
  force?: boolean;
}

export interface ReopenBacklogOptions {
  role: string;
  taskId: string;
}

export interface PatchBacklogOptions {
  role: string;
  taskId: string;
  complexity?: string;
  value?: string;
  priority?: string;
}

export interface ScoreBacklogOptions {
  role: string;
  taskId: string;
  complexity?: string;
  value?: string;
  priority?: string;
}

export interface MarkForReviewBacklogOptions {
  role: string;
  taskId: string;
}

export interface HistoryBacklogOptions {
  role: string;
  from?: string; // ISO date string e.g. "2026-03-01"
  to?: string;   // ISO date string e.g. "2026-03-16"
  // status removed - always shows both completed and closed
  limit?: number;
}

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<BacklogDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: {
      getSessionId,
      getConvexUrl,
      getOtherSessionUrls,
    },
  };
}

// ─── Auth Helper ───────────────────────────────────────────────────────────

function requireAuth(d: BacklogDeps): string {
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }
  return sessionId as string;
}

function validateChatroomId(chatroomId: string): void {
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
}

// ─── Commands ──────────────────────────────────────────────────────────────

/**
 * List active backlog items
 */
export async function listBacklog(
  chatroomId: string,
  options: ListBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  const limit = options.limit ?? 100;

  try {
    // Get backlog items from the dedicated chatroom_backlog table
    const backlogItems = await d.backend.query(api.backlog.listBacklogItems, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      statusFilter: 'active',
      limit,
    });

    // Display header
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('📋 ACTIVE BACKLOG');
    console.log('══════════════════════════════════════════════════');
    console.log(`Chatroom: ${chatroomId}`);
    console.log('');

    if (backlogItems.length === 0) {
      console.log('No active backlog items.');
    } else {
      console.log('──────────────────────────────────────────────────');

      for (let i = 0; i < backlogItems.length; i++) {
        const item = backlogItems[i]!;
        const statusEmoji = getStatusEmoji(item.status as BacklogItemStatus);
        const date = new Date(item.createdAt).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });

        console.log(`#${i + 1} [${statusEmoji} ${item.status.toUpperCase()}] ${item.content}`);
        console.log(`   ID: ${item._id}`);
        console.log(
          `   Created: ${date}${item.assignedTo ? ` | Assigned: ${item.assignedTo}` : ''}`
        );
        // Show scoring info if available
        if (item.complexity !== undefined || item.value !== undefined || item.priority !== undefined) {
          const parts: string[] = [];
          if (item.complexity) parts.push(`complexity=${item.complexity}`);
          if (item.value) parts.push(`value=${item.value}`);
          if (item.priority !== undefined) parts.push(`priority=${item.priority}`);
          console.log(`   Score: ${parts.join(' | ')}`);
        }
        console.log('');
      }
    }

    console.log('──────────────────────────────────────────────────');
    console.log(`Showing ${backlogItems.length} backlog item(s)`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to list backlog items: ${(error as Error).message}`);
    process.exit(1);
    return;
  }
}

/**
 * Add a task to the backlog
 */
export async function addBacklog(
  chatroomId: string,
  options: AddBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  // Validate content
  if (!options.content || options.content.trim().length === 0) {
    console.error(`❌ Task content cannot be empty`);
    process.exit(1);
    return;
  }

  try {
    const itemId = await d.backend.mutation(api.backlog.createBacklogItem, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      content: options.content.trim(),
      createdBy: options.role,
    });

    console.log('');
    console.log('✅ Task added to backlog');
    console.log(`   ID: ${itemId}`);
    console.log(`   Status: backlog`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to add task: ${(error as Error).message}`);
    process.exit(1);
    return;
  }
}

/**
 * Complete a backlog task by ID.
 * Use --force to complete stuck in_progress or pending tasks.
 */
export async function completeBacklog(
  chatroomId: string,
  options: CompleteBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  // Validate task ID
  if (!options.taskId || options.taskId.trim().length === 0) {
    console.error(`❌ Task ID is required`);
    process.exit(1);
    return;
  }

  try {
    const result = await d.backend.mutation(api.tasks.completeTaskById, {
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
    return;
  }
}

/**
 * Reopen a completed backlog task, returning it to pending_user_review status.
 */
export async function reopenBacklog(
  chatroomId: string,
  options: ReopenBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  // Validate task ID
  if (!options.taskId || options.taskId.trim().length === 0) {
    console.error(`❌ Task ID is required`);
    process.exit(1);
    return;
  }

  try {
    await d.backend.mutation(api.backlog.reopenBacklogItem, {
      sessionId,
      itemId: options.taskId as Id<'chatroom_backlog'>,
    });

    console.log('');
    console.log('✅ Task reopened');
    console.log(`   ID: ${options.taskId}`);
    console.log(`   Status: backlog`);
    console.log('');
    console.log('💡 The task is now ready for user review again.');
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to reopen task: ${(error as Error).message}`);
    process.exit(1);
    return;
  }
}

/**
 * Patch a task's scoring fields (complexity, value, priority).
 * Idempotent - can be called multiple times with same or different values.
 */
export async function patchBacklog(
  chatroomId: string,
  options: PatchBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  // Validate task ID
  if (!options.taskId || options.taskId.trim().length === 0) {
    console.error(`❌ Task ID is required`);
    process.exit(1);
    return;
  }

  // Validate at least one field is provided
  if (
    options.complexity === undefined &&
    options.value === undefined &&
    options.priority === undefined
  ) {
    console.error(`❌ At least one of --complexity, --value, or --priority is required`);
    process.exit(1);
    return;
  }

  // Validate complexity if provided
  const validComplexity = ['low', 'medium', 'high'];
  if (options.complexity !== undefined && !validComplexity.includes(options.complexity)) {
    console.error(
      `❌ Invalid complexity: ${options.complexity}. Must be one of: ${validComplexity.join(', ')}`
    );
    process.exit(1);
    return;
  }

  // Validate value if provided
  const validValue = ['low', 'medium', 'high'];
  if (options.value !== undefined && !validValue.includes(options.value)) {
    console.error(`❌ Invalid value: ${options.value}. Must be one of: ${validValue.join(', ')}`);
    process.exit(1);
    return;
  }

  // Parse and validate priority if provided
  let priorityNum: number | undefined;
  if (options.priority !== undefined) {
    priorityNum = parseInt(options.priority, 10);
    if (isNaN(priorityNum)) {
      console.error(`❌ Invalid priority: ${options.priority}. Must be a number.`);
      process.exit(1);
      return;
    }
  }

  try {
    await d.backend.mutation(api.tasks.patchTask, {
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
    return;
  }
}

/**
 * Score a backlog task by complexity, value, and priority.
 */
export async function scoreBacklog(
  chatroomId: string,
  options: ScoreBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  // Validate task ID
  if (!options.taskId || options.taskId.trim().length === 0) {
    console.error(`❌ Task ID is required`);
    process.exit(1);
    return;
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
    return;
  }

  // Validate complexity if provided
  const validComplexity = ['low', 'medium', 'high'];
  if (options.complexity !== undefined && !validComplexity.includes(options.complexity)) {
    console.error(
      `❌ Invalid complexity: ${options.complexity}. Must be one of: ${validComplexity.join(', ')}`
    );
    process.exit(1);
    return;
  }

  // Validate value if provided
  const validValue = ['low', 'medium', 'high'];
  if (options.value !== undefined && !validValue.includes(options.value)) {
    console.error(`❌ Invalid value: ${options.value}. Must be one of: ${validValue.join(', ')}`);
    process.exit(1);
    return;
  }

  // Parse and validate priority if provided
  let priorityNum: number | undefined;
  if (options.priority !== undefined) {
    priorityNum = parseInt(options.priority, 10);
    if (isNaN(priorityNum)) {
      console.error(`❌ Invalid priority: ${options.priority}. Must be a number.`);
      process.exit(1);
      return;
    }
  }

  try {
    await d.backend.mutation(api.tasks.patchTask, {
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
    return;
  }
}

/**
 * Mark a backlog task as ready for user review.
 */
export async function markForReviewBacklog(
  chatroomId: string,
  options: MarkForReviewBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  // Validate task ID
  if (!options.taskId || options.taskId.trim().length === 0) {
    console.error(`❌ Task ID is required`);
    process.exit(1);
    return;
  }

  try {
    await d.backend.mutation(api.backlog.markBacklogItemForReview, {
      sessionId,
      itemId: options.taskId as Id<'chatroom_backlog'>,
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
    return;
  }
}

/**
 * View completed and closed backlog items by date range.
 */
export async function historyBacklog(
  chatroomId: string,
  options: HistoryBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  // Parse date range
  const now = Date.now();
  const defaultFrom = now - 30 * 24 * 60 * 60 * 1000; // 30 days ago

  let fromMs: number | undefined;
  let toMs: number | undefined;

  if (options.from) {
    const parsed = Date.parse(options.from);
    if (isNaN(parsed)) {
      console.error(`❌ Invalid --from date: "${options.from}". Use YYYY-MM-DD format.`);
      process.exit(1);
      return;
    }
    fromMs = parsed;
  }

  if (options.to) {
    const parsed = Date.parse(options.to);
    if (isNaN(parsed)) {
      console.error(`❌ Invalid --to date: "${options.to}". Use YYYY-MM-DD format.`);
      process.exit(1);
      return;
    }
    // Include the full end day (end of day = +86399999ms)
    toMs = parsed + 86399999;
  }

  try {
    const tasks = await d.backend.query(api.tasks.listHistoricalTasks, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      from: fromMs,
      to: toMs,
      limit: options.limit,
    });

    // Compute display range strings
    const fromDate = new Date(fromMs ?? defaultFrom).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const toDate = new Date(toMs ?? now).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('📜 TASK HISTORY');
    console.log('══════════════════════════════════════════════════');
    console.log(`Chatroom: ${chatroomId}`);
    console.log(`Date range: ${fromDate} → ${toDate}`);
    console.log(`Filter: completed + closed`);
    console.log('');

    if (tasks.length === 0) {
      console.log('No history found for date range.');
    } else {
      console.log('──────────────────────────────────────────────────');
      console.log('📝 COMPLETED / CLOSED TASKS');
      console.log('──────────────────────────────────────────────────');

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i]!;
        const statusEmoji = getStatusEmoji(task.status as TaskStatus | BacklogItemStatus);
        const completedTs = (task as { completedAt?: number }).completedAt ?? task.updatedAt;
        const date = new Date(completedTs).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });

        console.log(`#${i + 1} [${statusEmoji} ${task.status.toUpperCase()}] ${task.content}`);
        console.log(`   ID: ${task._id}`);
        console.log(`   Completed: ${date}${task.assignedTo ? ` | Assigned: ${task.assignedTo}` : ''}`);
        if (task.complexity !== undefined || task.value !== undefined || task.priority !== undefined) {
          const parts: string[] = [];
          if (task.complexity) parts.push(`complexity=${task.complexity}`);
          if (task.value) parts.push(`value=${task.value}`);
          if (task.priority !== undefined) parts.push(`priority=${task.priority}`);
          console.log(`   Score: ${parts.join(' | ')}`);
        }
        console.log('');
      }
    }

    console.log('──────────────────────────────────────────────────');
    console.log(`Showing ${tasks.length} task(s)`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to load history: ${(error as Error).message}`);
    process.exit(1);
    return;
  }
}

function getStatusEmoji(status: TaskStatus | BacklogItemStatus): string {
  switch (status) {
    case 'pending':
      return '🟢';
    case 'acknowledged':
      return '📬';
    case 'in_progress':
      return '🔵';
    case 'backlog':
      return '⚪';
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
