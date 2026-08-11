import { test as base, expect, type Page } from '@playwright/test';
import type { SessionId } from 'convex-helpers/server/sessions';

import { loginAnonymously } from './auth.fixture';
import { promoteSessionToSystemAdmin } from '../support/convex-client';
import { assertE2eSeedingEnabled } from '../support/seed-guard';

type AdminFixtures = { systemAdminPage: Page };

export const test = base.extend<AdminFixtures>({
  systemAdminPage: async ({ page }, use) => {
    await loginAnonymously(page);
    const sessionId = await page.evaluate(() => localStorage.getItem('sessionId'));
    if (!sessionId) throw new Error('No sessionId in localStorage after anonymous login');

    // Fail-fast if Convex env not configured. Uses the real session so the probe
    // actually promotes the user when the gate is enabled.
    await assertE2eSeedingEnabled(sessionId as SessionId);

    await promoteSessionToSystemAdmin(sessionId as SessionId);
    await page.reload();
    await page.goto('/app/system-admin');
    await expect(page.getByRole('heading', { name: 'System Admin', level: 1 })).toBeVisible();
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture `use` is not a React hook
    await use(page);
  },
});

export { expect } from '@playwright/test';
