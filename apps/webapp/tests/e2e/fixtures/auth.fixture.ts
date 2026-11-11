import {
  test as base,
  expect,
  type ConsoleMessage,
  type Page,
  type Response,
  type TestInfo,
} from '@playwright/test';

import { AppDashboardPage } from '../pages/app-dashboard.page';
import { LoginPage } from '../pages/login.page';

/** Rejection raised by `auth.loginAnon` when the deployment does not allow self-signup. */
const SIGNUP_DISABLED_SIGNAL = /SIGNUP_DISABLED|Self-signup is not enabled/;

export const SIGNUP_DISABLED_SKIP_REASON =
  'Blocked: the Convex deployment rejects anonymous login (SIGNUP_DISABLED); set E2E_SEEDING_ENABLED=true on the dev deployment and re-run.';

/** Bounded below the default 30 s test timeout so an unknown failure reports the navigation, not a fixture timeout. */
const LOGIN_REDIRECT_TIMEOUT_MS = 20_000;

type AuthFixtures = {
  authenticatedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use, testInfo) => {
    await loginAnonymouslyOrSkip(page, testInfo);
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture `use` is not a React hook
    await use(page);
  },
});

export { expect } from '@playwright/test';

/** Strict anonymous login: any failure throws. Used by fixtures that must never skip (admin). */
export async function loginAnonymously(page: Page): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  await loginPage.loginAnonymously();
  const dashboard = new AppDashboardPage(page);
  await expect(dashboard.heading).toBeVisible();
}

/**
 * Anonymous login that skips the test only when the backend reports SIGNUP_DISABLED.
 * Any other failure (no redirect, missing control, wrong heading) still fails the test.
 */
async function loginAnonymouslyOrSkip(page: Page, testInfo: TestInfo): Promise<void> {
  const signupDisabled = watchForSignupDisabled(page);
  try {
    const loginPage = new LoginPage(page);
    await page.goto('/login');
    // Cold dev boots can compile /login slowly.
    await expect(loginPage.anonymousLoginButton).toBeVisible({ timeout: 15_000 });
    await loginPage.anonymousLoginButton.click();
    const outcome = await Promise.race([
      page
        .waitForURL('**/app', { timeout: LOGIN_REDIRECT_TIMEOUT_MS })
        .then(() => 'redirected' as const),
      signupDisabled.observed.then(() => 'signup-disabled' as const),
    ]);
    if (outcome === 'signup-disabled') {
      testInfo.skip(true, SIGNUP_DISABLED_SKIP_REASON);
    }
  } finally {
    signupDisabled.dispose();
  }
  await expect(new AppDashboardPage(page).heading).toBeVisible();
}

/** Resolves `observed` once the page logs or receives the SIGNUP_DISABLED rejection. */
function watchForSignupDisabled(page: Page): { observed: Promise<void>; dispose: () => void } {
  let markObserved: () => void = () => {};
  const observed = new Promise<void>((resolve) => {
    markObserved = resolve;
  });
  const inspect = (text: string) => {
    if (SIGNUP_DISABLED_SIGNAL.test(text)) markObserved();
  };
  const onConsole = (msg: ConsoleMessage) => {
    inspect(msg.text());
    for (const arg of msg.args()) {
      arg
        .jsonValue()
        .then((value) => inspect(typeof value === 'string' ? value : (JSON.stringify(value) ?? '')))
        .catch(() => {});
    }
  };
  const onResponse = (response: Response) => {
    if (!/convex|api/i.test(response.url())) return;
    response
      .text()
      .then(inspect)
      .catch(() => {});
  };
  page.on('console', onConsole);
  page.on('response', onResponse);
  return {
    observed,
    dispose: () => {
      page.off('console', onConsole);
      page.off('response', onResponse);
    },
  };
}
