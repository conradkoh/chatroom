import { expect, test, type ConsoleMessage, type Response } from '@playwright/test';

import { LoginPage } from '../../pages/login.page';
import { TAG_DOWNSTREAM } from '../../support/tags';

/**
 * Composer preflight shortcut focus (downstream Chromium smoke).
 *
 * Covers the user story: pressing the repository-supported preflight shortcut
 * for N (Ctrl+N on non-Windows platforms) toggles the new-session preference
 * and leaves the chat input ready for typing; the M shortcut (Ctrl+M) does the
 * same when the conversation-mode transition is actually accepted.
 *
 * Real-application flow only: anonymous login via the production login page,
 * chatroom creation through the production ChatroomSelector UI, then keyboard
 * events against the real dashboard. Nothing is stubbed except the platform
 * string (to pin the documented non-Windows Ctrl modifier mapping).
 *
 * Truthful preconditions (a missing/renamed control must fail, never skip):
 * - anonymous login may only skip when the real backend rejection signal
 *   SIGNUP_DISABLED / "Self-signup is not enabled" is observed after clicking
 *   Continue Anonymously; any other /app wait failure is rethrown.
 * - chatroom-creation and composer/preflight visibility assertions are
 *   ordinary assertions and must fail on regression.
 * - enhancer mode unsupported for the team, or the incomplete enhancer
 *   configuration dialog opens instead of cycling (both must NOT steal focus)
 */
test.describe('Composer preflight shortcut focus', { tag: [TAG_DOWNSTREAM] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });
    });
  });

  test('Ctrl+N focuses the composer after toggling; Ctrl+M focuses it when mode cycles', async ({
    page,
  }) => {
    // Cold dev boot can take a while; keep every precondition step bounded
    // below this budget. Login/creation/composer assertions below are ordinary
    // assertions: unexpected product or UI regressions must fail, never skip.
    test.setTimeout(120_000);
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await expect(loginPage.anonymousLoginButton).toBeVisible({ timeout: 15_000 });

    // Capture real-app rejection signals before clicking, so the /app wait
    // below can only become a skip when the backend actually reports the known
    // SIGNUP_DISABLED condition. Any other timeout is rethrown to fail.
    const observedSignals: string[] = [];
    const onConsole = (msg: ConsoleMessage) => {
      observedSignals.push(msg.text());
      for (const arg of msg.args()) {
        arg
          .jsonValue()
          .then((value) => {
            try {
              observedSignals.push(typeof value === 'string' ? value : JSON.stringify(value));
            } catch {
              // Ignore serialization failures; msg.text() already captured.
            }
          })
          .catch(() => {});
      }
    };
    const onResponse = (response: Response) => {
      if (!/convex|api/i.test(response.url())) return;
      response
        .text()
        .then((body) => {
          if (/SIGNUP_DISABLED|Self-signup is not enabled/.test(body)) {
            observedSignals.push(body.slice(0, 4000));
          }
        })
        .catch(() => {});
    };
    page.on('console', onConsole);
    page.on('response', onResponse);
    await loginPage.anonymousLoginButton.click();
    try {
      await page.waitForURL((url) => url.pathname.startsWith('/app'), { timeout: 20_000 });
    } catch (error) {
      // Allow async console/network collectors and the login-error toast to land.
      await page.waitForTimeout(1_500);
      const loginErrorToast = page.getByText('Failed to login. Please try again later.');
      if (await loginErrorToast.isVisible().catch(() => false)) {
        observedSignals.push('Failed to login. Please try again later.');
      }
      await page.waitForTimeout(500);
      const signal = observedSignals.join('\n');
      page.off('console', onConsole);
      page.off('response', onResponse);
      if (/SIGNUP_DISABLED|Self-signup is not enabled/.test(signal)) {
        test.skip(
          true,
          'Blocked: anonymous login did not reach /app (observed real backend signal ' +
            'SIGNUP_DISABLED / "Self-signup is not enabled" after clicking Continue Anonymously, ' +
            'so no authenticated session exists to enter a chatroom). ' +
            'Use a deployment with self-signup enabled and re-run.'
        );
        return;
      }
      throw error;
    }
    page.off('console', onConsole);
    page.off('response', onResponse);

    // Enter a real chatroom: create one through the production selector UI.
    // Intentionally uncaught: a missing/renamed control or broken route must fail.
    const createEntry = page.getByRole('button', { name: 'Create New Chatroom' });
    await expect(createEntry.first()).toBeVisible({ timeout: 15_000 });
    await createEntry.first().click();
    const submit = page.getByRole('button', { name: 'Create Chatroom' });
    await expect(submit).toBeVisible({ timeout: 10_000 });
    await submit.click();
    await page.waitForURL('**/app/chatroom**', { timeout: 15_000 });

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

    // Ctrl+M focuses the composer only when the mode transition is accepted.
    await composer.evaluate((el) => (el as HTMLElement).blur());
    await expect(composer).not.toBeFocused();
    await page.keyboard.press('Control+m');

    const focused = await expect(composer)
      .toBeFocused({ timeout: 3_000 })
      .then(
        () => true,
        () => false
      );
    if (focused) {
      return;
    }

    // Not focused: only acceptable when the shortcut did not cycle mode.
    const configDialog = page.getByText('Enhancer configuration');
    if (await configDialog.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      test.skip(
        true,
        'Real precondition: Ctrl+M opened the incomplete enhancer configuration dialog ' +
          '(no complete enhancer config for this chatroom), so no mode transition ' +
          'occurred and focus was correctly not stolen.'
      );
      return;
    }
    const unsupportedToast = page.getByText('Enhancer is available to Solo and Duo teams.');
    if (await unsupportedToast.isVisible().catch(() => false)) {
      test.skip(
        true,
        'Real precondition: enhancer mode is unsupported for this chatroom team, ' +
          'so Ctrl+M showed the unsupported toast instead of cycling mode.'
      );
      return;
    }
    expect(composer).toBeFocused();
  });
});
