import type { Page } from '@playwright/test';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { ConvexHttpClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';

type QueueEntry = { _id: string; content: string };

function sidebarSection(page: Page, title: 'Current' | 'Queued') {
  const heading = page.getByText(new RegExp(`^${title} \\(\\d+\\)$`));
  return heading.locator('xpath=ancestor::section[1]');
}

function contents(queue: QueueEntry[]): string[] {
  return queue.map((entry) => entry.content);
}

/**
 * Creates an isolated chatroom with one active task and queues Message A, B, C
 * in that order. `enqueueMessageAtFront` prepends, so the API calls run C → B → A.
 */
async function seedQueue(page: Page): Promise<{
  client: ConvexHttpClient;
  sessionId: SessionId;
  chatroomId: Id<'chatroom_rooms'>;
  byContent: Map<string, string>;
}> {
  const rawSessionId = await page.evaluate(() => localStorage.getItem('sessionId'));
  expect(rawSessionId, 'anonymous login should persist a session').toBeTruthy();
  const sessionId = rawSessionId as SessionId;
  const client = new ConvexHttpClient(getConvexUrl());
  const chatroomId = await client.mutation(api.chatrooms.create, {
    sessionId,
    teamStructureId: 'duo@1',
  });
  await client.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    createdBy: 'planner',
    content: 'Active task so new messages queue',
  });

  for (const content of ['Message C', 'Message B', 'Message A']) {
    await client.mutation(api.messages.enqueueMessageAtFront, {
      sessionId,
      chatroomId,
      content,
    });
  }

  const queue = (await client.query(api.messages.listQueued, {
    sessionId,
    chatroomId,
  })) as QueueEntry[];
  expect(contents(queue)).toEqual(['Message A', 'Message B', 'Message C']);

  return {
    client,
    sessionId,
    chatroomId,
    byContent: new Map(queue.map((entry) => [entry.content, entry._id])),
  };
}

/** Opens the chatroom page and dismisses the first-run workspace dialog. */
async function openChatroom(page: Page, chatroomId: Id<'chatroom_rooms'>) {
  await page.goto(`/app/chatroom?id=${chatroomId}`);
  const setupWorkspaceDialog = page.getByRole('dialog');
  await expect(
    setupWorkspaceDialog.getByRole('heading', { name: 'Setup Workspace' })
  ).toBeVisible();
  await setupWorkspaceDialog.getByRole('button', { name: 'Close' }).click();
  await expect(setupWorkspaceDialog).toHaveCount(0);
}

function queuedRowIds(page: Page) {
  return sidebarSection(page, 'Queued')
    .locator('[data-queued-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-queued-id')));
}

test.describe('Queued message reordering', { tag: [TAG_DOWNSTREAM] }, () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('moves the last queued message to the front with the keyboard', async ({
    authenticatedPage: page,
  }) => {
    const { client, sessionId, chatroomId, byContent } = await seedQueue(page);
    await openChatroom(page, chatroomId);

    const queuedSection = sidebarSection(page, 'Queued');
    await expect(queuedSection.getByText('Message C', { exact: true })).toBeVisible();

    const handleC = page.getByTestId(`queued-reorder-handle-${byContent.get('Message C')}`);
    await handleC.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Space');

    await expect
      .poll(
        async () =>
          contents(
            (await client.query(api.messages.listQueued, {
              sessionId,
              chatroomId,
            })) as QueueEntry[]
          ),
        { timeout: 10_000 }
      )
      .toEqual(['Message C', 'Message A', 'Message B']);

    await expect
      .poll(() => queuedRowIds(page), { timeout: 10_000 })
      .toEqual([
        byContent.get('Message C'),
        byContent.get('Message A'),
        byContent.get('Message B'),
      ]);
  });

  test('moves the last queued message above the first by dragging its handle', async ({
    authenticatedPage: page,
  }) => {
    const { client, sessionId, chatroomId, byContent } = await seedQueue(page);
    await openChatroom(page, chatroomId);

    const queuedSection = sidebarSection(page, 'Queued');
    await expect(queuedSection.getByText('Message C', { exact: true })).toBeVisible();

    await page.dragAndDrop(
      `[data-testid="queued-reorder-handle-${byContent.get('Message C')}"]`,
      `[data-testid="queued-row-${byContent.get('Message A')}"]`,
      { targetPosition: { x: 10, y: 2 } }
    );

    await expect
      .poll(
        async () =>
          contents(
            (await client.query(api.messages.listQueued, {
              sessionId,
              chatroomId,
            })) as QueueEntry[]
          ),
        { timeout: 10_000 }
      )
      .toEqual(['Message C', 'Message A', 'Message B']);
  });
});
