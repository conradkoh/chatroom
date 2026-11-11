import type { Page } from '@playwright/test';
import { api } from '@workspace/backend/convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';

async function dismissSetupWorkspace(page: Page): Promise<void> {
  const setupWorkspaceDialog = page.getByRole('dialog');
  await expect(
    setupWorkspaceDialog.getByRole('heading', { name: 'Setup Workspace' })
  ).toBeVisible();
  await setupWorkspaceDialog.getByRole('button', { name: 'Close' }).click();
  await expect(setupWorkspaceDialog).toHaveCount(0);
}

/**
 * Composer preflight shortcut focus (downstream Chromium smoke).
 *
 * Covers the user story: pressing the repository-supported preflight shortcut
 * for N (Ctrl+N on non-Windows platforms) toggles the new-session preference
 * and leaves the chat input ready for typing.
 *
 * Real-application flow only: anonymous login via the production login page,
 * chatroom creation through the production ChatroomSelector UI, then keyboard
 * events against the real dashboard. Nothing is stubbed except the platform
 * string (to pin the documented non-Windows Ctrl modifier mapping).
 *
 * Truthful preconditions (a missing/renamed control must fail, never skip):
 * - anonymous login goes through the shared authenticatedPage fixture, which skips only on the real backend SIGNUP_DISABLED / "Self-signup is not enabled" signal; any other login failure fails.
 * - chatroom-creation and composer/preflight visibility assertions are
 *   ordinary assertions and must fail on regression.
 */
test.describe('Composer preflight new-session shortcut focus', { tag: [TAG_DOWNSTREAM] }, () => {
  // Cold dev boot can take a while; the budget must cover fixture login, which runs before the test body.
  test.describe.configure({ timeout: 120_000 });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });
    });
  });

  test('Ctrl+N focuses the composer after toggling', async ({ authenticatedPage: page }) => {
    // Enter a real chatroom. The new-chatroom wizard needs a connected machine, which this spec
    // does not provide, so the room is created through the backend and the test enters it by URL.
    // Intentionally uncaught: a failed login or backend error must fail the test.
    const rawSessionId = await page.evaluate(() => localStorage.getItem('sessionId'));
    expect(rawSessionId, 'anonymous login should persist a session').toBeTruthy();
    const client = new ConvexHttpClient(getConvexUrl());
    const chatroomId = await client.mutation(api.chatrooms.create, {
      sessionId: rawSessionId as SessionId,
      teamStructureId: 'duo@1',
    });
    await page.goto(`/app/chatroom?id=${chatroomId}`);
    await dismissSetupWorkspace(page);

    // Required product surfaces: missing composer or preflight bar must fail.
    const preflightBar = page.getByTestId('composer-preflight-bar');
    const composer = page.getByPlaceholder('Type a message...');
    await expect(preflightBar).toBeVisible({ timeout: 15_000 });
    await expect(composer).toBeVisible({ timeout: 15_000 });

    // Ctrl+N toggles the new-session preference and must focus the composer.
    await composer.evaluate((el) => (el as HTMLElement).blur());
    await expect(composer).not.toBeFocused();
    await page.keyboard.press('Control+n');
    await expect(composer).toBeFocused();
  });
});
