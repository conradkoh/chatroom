import type { Page } from '@playwright/test';
import { api } from '@workspace/backend/convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { test as authenticatedTest, expect } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';

const test = authenticatedTest.extend({
  // The shared fixture's dashboard heading is stale; retain its authenticatedPage
  // contract while checking the actual current dashboard heading here.
  authenticatedPage: async ({ page }, use) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /continue anonymously/i }).click();
    await page.waitForURL('**/app');
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    // Playwright fixture `use` is not a React hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

function sidebarSection(page: Page, title: 'Current' | 'Queued') {
  const heading = page.getByText(new RegExp(`^${title} \\(\\d+\\)$`));
  return heading.locator('xpath=ancestor::section[1]');
}

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
      const setupWorkspaceDialog = page.getByRole('dialog');
      await expect(
        setupWorkspaceDialog.getByRole('heading', { name: 'Setup Workspace' })
      ).toBeVisible();
      await setupWorkspaceDialog.getByRole('button', { name: 'Close' }).click();
      await expect(setupWorkspaceDialog).toHaveCount(0);
      const currentSection = sidebarSection(page, 'Current');
      const queuedSection = sidebarSection(page, 'Queued');
      await expect(page.getByRole('button', { name: 'Start Next' })).toHaveCount(0);
      await expect(
        currentSection.getByText('Agent task to force complete', { exact: true })
      ).toBeVisible();
      await expect(
        queuedSection.getByText('Queued message to recover', { exact: true })
      ).toBeVisible();

      await currentSection.getByText('Agent task to force complete', { exact: true }).click();
      const forceComplete = page.getByRole('button', { name: 'Force Complete', exact: true });
      await expect(forceComplete).toBeVisible();
      await forceComplete.click();
      await expect(forceComplete).toHaveCount(0);
      await expect(currentSection.getByText('No current tasks', { exact: true })).toBeVisible();
      await expect(
        queuedSection.getByText('Queued message to recover', { exact: true })
      ).toBeVisible();

      const startNext = page.getByRole('button', { name: 'Start Next' });
      await expect(startNext).toBeVisible({ timeout: 8_000 });
      await startNext.click();
      await expect(
        currentSection.getByText('Queued message to recover', { exact: true })
      ).toBeVisible();
      await expect(queuedSection.getByText('No queued messages', { exact: true })).toBeVisible();
      await expect(startNext).toHaveCount(0);

      const activeTasks = await client.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'active',
        limit: 100,
      });
      const original = await client.query(api.tasks.getTask, { sessionId, chatroomId, taskId });
      const queue = await client.query(api.messages.listQueued, { sessionId, chatroomId });
      expect(activeTasks).toHaveLength(1);
      expect(activeTasks[0]).toMatchObject({
        content: 'Queued message to recover',
        status: 'pending',
      });
      expect(original?.status).toBe('completed');
      expect(queue).toHaveLength(0);
    });
  });
});
