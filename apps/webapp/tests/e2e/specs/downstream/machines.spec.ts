import type { Page } from '@playwright/test';
import { api } from '@workspace/backend/convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM, TAG_NAV } from '../../support/tags';
import { readSessionId, seedConnectedMachine } from '../../support/wizard-seed';

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 } as const;
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

/** Opens the card's actions menu and selects one entry by its stable test id. */
async function runMachineAction(page: Page, action: 'rename' | 'delete'): Promise<void> {
  await page.getByTestId('machine-actions-trigger').click();
  await page.getByTestId(`machine-action-${action}`).click();
}

test.describe('Machines tab', { tag: [TAG_DOWNSTREAM, TAG_NAV] }, () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('navigates between Chatrooms and Machines from the section strip', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/app');

    // A fresh anonymous account has no chatrooms: the strip must show in the empty state.
    const machinesTab = page.getByTestId('app-section-tab-machines');
    await expect(machinesTab).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('app-section-tab-chatrooms')).toHaveAttribute(
      'aria-current',
      'page'
    );

    await machinesTab.click();
    await expect(page).toHaveURL(/\/app\/machines$/);
    await expect(page.getByTestId('app-section-tab-machines')).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expect(page.getByRole('heading', { name: 'Machines' })).toBeVisible();

    await page.getByTestId('app-section-tab-chatrooms').click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByTestId('app-section-tab-chatrooms')).toHaveAttribute(
      'aria-current',
      'page'
    );

    // A direct visit renders the page with the strip already active.
    await page.goto('/app/machines');
    await expect(page.getByRole('heading', { name: 'Machines' })).toBeVisible();
    await expect(page.getByTestId('app-section-tab-machines')).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  test('shows the empty state with the daemon start command for a new account', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/app/machines');

    const empty = page.getByTestId('machines-empty');
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty).toContainText('No machines registered');
    // Non-production deployments prefix the command with CHATROOM_CONVEX_URL.
    await expect(page.getByTestId('machines-empty-command')).toContainText(
      'chatroom machine daemon start'
    );
  });

  test('renames a machine inline and keeps the alias after reload', async ({
    authenticatedPage: page,
  }) => {
    const sessionId = await readSessionId(page);
    const client = new ConvexHttpClient(getConvexUrl());
    await seedConnectedMachine(client, sessionId, {
      hostname: 'e2e-machines-rename-host',
      idPrefix: 'e2e-machines-rename',
    });

    await page.goto('/app/machines');
    await expect(page.getByTestId('machine-status')).toHaveText('Online', { timeout: 15_000 });
    await expect(page.getByTestId('machine-name')).toHaveText('e2e-machines-rename-host');

    await runMachineAction(page, 'rename');
    const input = page.getByTestId('machine-alias-input');
    await expect(input).toBeVisible();
    await input.fill('E2E Alias');
    await input.press('Enter');
    await expect(page.getByTestId('machine-name')).toHaveText('E2E Alias');

    await page.reload();
    await expect(page.getByTestId('machine-name')).toHaveText('E2E Alias', { timeout: 15_000 });
  });

  test('blocks deletion while online, then deletes once the daemon is offline', async ({
    authenticatedPage: page,
  }) => {
    const sessionId = await readSessionId(page);
    const client = new ConvexHttpClient(getConvexUrl());
    const machineId = await seedConnectedMachine(client, sessionId, {
      hostname: 'e2e-machines-delete-host',
      idPrefix: 'e2e-machines-delete',
    });

    await page.goto('/app/machines');
    const card = page.locator(`[data-testid="machine-card"][data-machine-id="${machineId}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('machine-status')).toHaveText('Online');

    // Online: the dialog explains the guard and offers no destructive action.
    await runMachineAction(page, 'delete');
    const blocked = page.getByTestId('delete-machine-blocked');
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText('Stop the daemon and wait until it shows offline');
    await expect(page.getByRole('button', { name: 'Delete machine' })).toHaveCount(0);

    // The daemon stops: the open dialog flips to the confirm variant live.
    await client.mutation(api.machines.markDaemonOffline, { sessionId, machineId });
    const confirm = page.getByTestId('delete-machine-confirm');
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await expect(confirm).toBeEnabled({ timeout: 15_000 });

    await confirm.click();
    await expect(page.getByTestId('delete-machine-dialog')).toHaveCount(0, { timeout: 15_000 });
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('machines-empty')).toBeVisible({ timeout: 15_000 });

    const after = await client.query(api.machines.getUserMachines, { sessionId });
    expect(after.machines.map((machine) => machine.machineId)).not.toContain(machineId);
  });
});

test.describe('Machines tab (mobile)', { tag: [TAG_DOWNSTREAM, TAG_NAV] }, () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test('navigates from the strip and keeps the delete dialog inside the viewport', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/app');
    const machinesTab = page.getByTestId('app-section-tab-machines');
    await expect(machinesTab).toBeVisible({ timeout: 15_000 });
    await machinesTab.click();
    await expect(page).toHaveURL(/\/app\/machines$/);

    const sessionId = await readSessionId(page);
    const client = new ConvexHttpClient(getConvexUrl());
    const machineId = await seedConnectedMachine(client, sessionId, {
      hostname: 'e2e-machines-mobile-host',
      idPrefix: 'e2e-machines-mobile',
    });

    await page.goto('/app/machines');
    const card = page.locator(`[data-testid="machine-card"][data-machine-id="${machineId}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });

    await runMachineAction(page, 'delete');
    const dialog = page.getByTestId('delete-machine-dialog');
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    if (!box) throw new Error('the delete dialog should have a layout box');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(hasHorizontalScroll).toBe(false);
  });
});
