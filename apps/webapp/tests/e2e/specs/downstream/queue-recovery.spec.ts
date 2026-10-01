import { api } from '@workspace/backend/convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { test, expect } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';

test.describe('Manual queue recovery', { tag: [TAG_DOWNSTREAM] }, () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('starts the queued message after force completing the last agent task', async ({
    authenticatedPage: page,
  }) => {
    await test.step('create an isolated chatroom with an agent task and queued message', async () => {
      const rawSessionId = await page.evaluate(() => localStorage.getItem('sessionId'));
      expect(rawSessionId, 'anonymous login should persist a session').toBeTruthy();
      const sessionId = rawSessionId as SessionId;
      const client = new ConvexHttpClient(getConvexUrl());
      const chatroomId = await client.mutation(api.chatrooms.create, {
        sessionId,
        teamStructureId: 'duo@1',
      });
      const { taskId } = await client.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        createdBy: 'planner',
        content: 'Agent task to force complete',
      });
      await client.mutation(api.messages.enqueueMessageAtFront, {
        sessionId,
        chatroomId,
        content: 'Queued message to recover',
      });

      await page.goto(`/app/chatroom?id=${chatroomId}`);
      await expect(page.getByRole('button', { name: 'Start Next' })).toHaveCount(0);
      await expect(page.getByText('Agent task to force complete')).toBeVisible();

      await page.getByText('Agent task to force complete').click();
      await page.getByRole('button', { name: 'Force Complete' }).click();
      await expect(page.getByText('No current tasks')).toBeVisible();
      await expect(page.getByText('Queued message to recover')).toBeVisible();

      const startNext = page.getByRole('button', { name: 'Start Next' });
      await expect(startNext).toBeVisible({ timeout: 8_000 });
      await startNext.click();
      await expect(page.getByText('No current tasks')).toHaveCount(0);
      await expect(page.getByText('Queued (0)')).toBeVisible();
      await expect(startNext).toHaveCount(0);
      await expect(page.getByText('Queued message to recover').first()).toBeVisible();

      const activeTasks = await client.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'active',
        limit: 100,
      });
      const original = await client.query(api.tasks.getTask, { sessionId, chatroomId, taskId });
      const queue = await client.query(api.messages.listQueued, { sessionId, chatroomId });
      expect(
        activeTasks.filter((task) => task.content === 'Queued message to recover')
      ).toHaveLength(1);
      expect(original?.status).toBe('completed');
      expect(queue).toHaveLength(0);
    });
  });
});
