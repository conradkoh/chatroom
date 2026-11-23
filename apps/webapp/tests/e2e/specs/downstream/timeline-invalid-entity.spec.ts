import { api } from '@workspace/backend/convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';

// Built from a char code so this file never holds a literal out-of-range numeric entity.
const AMP = String.fromCharCode(38);
const MARKER = 'Out-of-range entity marker';
const HANDOFF_CONTENT = [
  '## Summary',
  `${MARKER}: result ${AMP}#1114112; stays as written.`,
  '',
  '## Goal',
  'Confirm the chat panel renders this handoff.',
].join('\n');

// The production crash text, from a caught render error or an uncaught page error.
const CRASH_PATTERN = /not a valid code point|RangeError/;

test.describe('Chat panel with out-of-range numeric entity', { tag: [TAG_DOWNSTREAM] }, () => {
  test('renders a handoff carrying the 0x110000 entity with no app-level error screen', async ({
    authenticatedPage: page,
  }) => {
    const crashLogs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && CRASH_PATTERN.test(msg.text())) crashLogs.push(msg.text());
    });
    page.on('pageerror', (error) => {
      if (CRASH_PATTERN.test(error.message)) crashLogs.push(error.message);
    });

    const rawSessionId = await page.evaluate(() => localStorage.getItem('sessionId'));
    expect(rawSessionId, 'anonymous login should persist a session').toBeTruthy();
    const sessionId = rawSessionId as SessionId;
    const client = new ConvexHttpClient(getConvexUrl());
    const chatroomId = await client.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'trio@1',
    });

    await test.step('open the empty chatroom', async () => {
      await page.goto(`/app/chatroom?id=${chatroomId}`);
    });

    await test.step('dismiss the Setup Workspace dialog', async () => {
      const setupWorkspaceDialog = page.getByRole('dialog');
      await expect(
        setupWorkspaceDialog.getByRole('heading', { name: 'Setup Workspace' })
      ).toBeVisible();
      await setupWorkspaceDialog.getByRole('button', { name: 'Close' }).click();
      await expect(setupWorkspaceDialog).toHaveCount(0);
    });

    await test.step('send a user message, then the handoff carrying the entity', async () => {
      // The conversation slice anchors at the latest user message, so the anchor must exist
      // before the handoff can appear in the panel. It also keeps the room out of setup mode.
      await client.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Show me the handoff.',
        type: 'message',
      });
      const result = await client.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'coordinator',
        targetRole: 'user',
        content: HANDOFF_CONTENT,
      });
      expect(result.success, JSON.stringify(result.error)).toBe(true);
    });

    await test.step('the handoff row renders and no error screen appears', async () => {
      // Positive proof first: the row with the entity is on screen, so the absence checks mean something.
      const row = page.getByTestId('timeline-team-message').filter({ hasText: MARKER });
      await expect(row).toBeVisible();
      await expect(page.getByTestId('timeline-row-error')).toHaveCount(0);
      await expect(page.getByText('Something went wrong', { exact: true })).toHaveCount(0);
      expect(crashLogs, 'no RangeError should be raised or logged').toEqual([]);
    });
  });
});
