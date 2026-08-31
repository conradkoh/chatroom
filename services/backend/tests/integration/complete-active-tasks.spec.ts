/**
 * completeActiveTasksForRole — Integration Tests
 *
 * Verifies role filtering: only tasks for the specified role are completed.
 */

import { describe, expect, test } from 'vitest';

import { setupWorkspaceForSession } from './harness-fixtures';
import { completeActiveTasksForRole } from '../../src/domain/usecase/task/complete-active-tasks';
import { t } from '../../test.setup';

describe('completeActiveTasksForRole', () => {
  test('completes only planner tasks, leaves builder tasks in_progress', async () => {
    const { chatroomId } = await setupWorkspaceForSession('complete-role-filter');

    await t.run(async (ctx) => {
      // Insert planner in_progress task
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Planner task',
        status: 'in_progress',
        assignedTo: 'planner',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });

      // Insert builder in_progress task
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'planner',
        content: 'Builder task',
        status: 'in_progress',
        assignedTo: 'builder',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 2,
      });
    });

    // Call the usecase directly inside t.run
    await t.run(async (ctx) => {
      await completeActiveTasksForRole(ctx, chatroomId, 'planner', {
        skipAutoPromotion: true,
      });
    });

    // Verify results
    const allTasks = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );

    const plannerTask = allTasks.find((t) => t.assignedTo === 'planner');
    expect(plannerTask).toBeDefined();
    expect(plannerTask!.status).toBe('completed');

    const builderTask = allTasks.find((t) => t.assignedTo === 'builder');
    expect(builderTask).toBeDefined();
    expect(builderTask!.status).toBe('in_progress');
  });
});
