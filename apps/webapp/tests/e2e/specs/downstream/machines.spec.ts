import type { Locator, Page } from '@playwright/test';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { ConvexHttpClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM, TAG_NAV } from '../../support/tags';
import { readSessionId, seedConnectedMachine } from '../../support/wizard-seed';

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 } as const;
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

const ROW_HEIGHT = 72;

type LedgerRequestId = Id<'chatroom_repositoryLedgerRequests'>;

/** Project root the seeded machine owns. Every snapshot entry sits directly under it. */
const LEDGER_ROOT = '/e2e/ledger';
/** Distinct names, so each filter term below matches exactly one row. */
const LEDGER_REPO_NAMES = ['repo-alpha', 'repo-bravo', 'repo-charlie'] as const;

/**
 * An online machine with one project root. Load needs both. `page` must already be authenticated.
 */
async function seedLedgerMachine(page: Page, hostname: string, idPrefix: string) {
  const sessionId: SessionId = await readSessionId(page);
  const client = new ConvexHttpClient(getConvexUrl());
  const machineId = await seedConnectedMachine(client, sessionId, { hostname, idPrefix });
  await client.mutation(api.machineProjectRoots.add, { sessionId, machineId, path: LEDGER_ROOT });
  return { client, sessionId, machineId };
}

type LedgerSeed = Awaited<ReturnType<typeof seedLedgerMachine>>;

/** Opens /app/machines, waits for the card to be Online, and expands it. */
async function openExpandedCard(page: Page, machineId: string): Promise<Locator> {
  await page.goto('/app/machines');
  const card = page.locator(`[data-testid="machine-card"][data-machine-id="${machineId}"]`);
  await expect(card.getByTestId('machine-status')).toHaveText('Online', { timeout: 15_000 });
  await card.getByTestId('machine-expander').click();
  return card;
}

/**
 * Creates the pending request that the Load click will reuse, so the test learns its id.
 * Call it before the Load click. See Key Knowledge: the order matters.
 */
async function createPendingRequest(seed: LedgerSeed): Promise<LedgerRequestId> {
  const { requestId } = await seed.client.mutation(api.repositoryLedger.request, {
    sessionId: seed.sessionId,
    machineId: seed.machineId,
    rescan: false,
  });
  return requestId;
}

/** Completes the pending request as the machine owner. This stands in for the daemon's report. */
async function reportSnapshot(
  seed: LedgerSeed,
  requestId: LedgerRequestId,
  droppedEntryCount?: number
): Promise<void> {
  await seed.client.mutation(api.repositoryLedger.reportResult, {
    sessionId: seed.sessionId,
    machineId: seed.machineId,
    requestId,
    status: 'completed',
    entries: LEDGER_REPO_NAMES.map((name) => ({
      name,
      path: `${LEDGER_ROOT}/${name}`,
      root: LEDGER_ROOT,
      branch: 'main',
      discoveredAt: Date.now(),
    })),
    roots: [{ path: LEDGER_ROOT, status: 'ok', repositoryCount: LEDGER_REPO_NAMES.length }],
    ledgerGeneratedAt: Date.now(),
    droppedEntryCount,
  });
}

/** Load → asking → report → rows render. Every Load test goes through this path. */
async function loadSnapshotThroughUi(
  card: Locator,
  seed: LedgerSeed,
  requestId: LedgerRequestId,
  droppedEntryCount?: number
): Promise<void> {
  await card.getByTestId('ledger-load').click();
  await expect(card.getByTestId('ledger-asking')).toBeVisible();
  await reportSnapshot(seed, requestId, droppedEntryCount);
  await expect(card.getByTestId('ledger-ready')).toBeVisible({ timeout: 15_000 });
  await expect(card.getByTestId('repository-row')).toHaveCount(LEDGER_REPO_NAMES.length, {
    timeout: 15_000,
  });
}

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

  test('manages project roots from the expanded card', async ({ authenticatedPage: page }) => {
    const sessionId = await readSessionId(page);
    const client = new ConvexHttpClient(getConvexUrl());
    const machineId = await seedConnectedMachine(client, sessionId, {
      hostname: 'e2e-machines-roots-host',
      idPrefix: 'e2e-machines-roots',
    });

    await page.goto('/app/machines');
    const card = page.locator(`[data-testid="machine-card"][data-machine-id="${machineId}"]`);
    await expect(card.getByTestId('machine-status')).toHaveText('Online', { timeout: 15_000 });

    await card.getByTestId('machine-expander').click();
    await expect(card.getByTestId('project-roots-empty')).toBeVisible();

    const input = card.getByLabel('Project root path');

    // Add with Enter: the list, counter and success note update, the input clears.
    await input.fill('/e2e/roots/a/b');
    await input.press('Enter');
    await expect(card.getByTestId('project-root-row')).toHaveCount(1);
    await expect(card.getByTestId('project-roots-count')).toHaveText('1 / 20');
    await expect(input).toHaveValue('');

    // Duplicate: the copy shows and the typed value is kept.
    await input.fill('/e2e/roots/a/b');
    await card.getByTestId('project-roots-add').click();
    await expect(card.getByTestId('project-roots-error')).toHaveText(
      'That folder is already a project root.'
    );
    await expect(input).toHaveValue('/e2e/roots/a/b');

    // Nested below the existing root.
    await input.fill('/e2e/roots/a/b/c');
    await input.press('Enter');
    await expect(card.getByTestId('project-roots-error')).toHaveText(
      'That folder is already inside an existing project root.'
    );

    // Collapsing the parent replaces the child.
    await input.fill('/e2e/roots/a');
    await input.press('Enter');
    await expect(card.getByTestId('project-roots-success')).toContainText(
      'Replaced 1 nested root: /e2e/roots/a/b'
    );
    await expect(card.getByTestId('project-root-row')).toHaveCount(1);

    // Offline: adding is disabled with the note, removing still works.
    await client.mutation(api.machines.markDaemonOffline, { sessionId, machineId });
    await expect(card.getByTestId('project-roots-offline')).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('project-roots-add')).toBeDisabled();
    await expect(input).toBeDisabled();

    await card.getByRole('button', { name: 'Remove project root /e2e/roots/a' }).click();
    await expect(card.getByTestId('project-roots-empty')).toBeVisible();
  });
});

test.describe('Machines tab repositories', { tag: [TAG_DOWNSTREAM] }, () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('loads on demand, shows the snapshot, and filters it with a no-match state', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedLedgerMachine(page, 'e2e-ledger-load-host', 'e2e-ledger-load');
    const requestId = await createPendingRequest(seed);
    const card = await openExpandedCard(page, seed.machineId);
    await expect(card.getByTestId('ledger-idle')).toBeVisible();

    await loadSnapshotThroughUi(card, seed, requestId);
    await expect(card.getByTestId('ledger-summary')).toContainText('not kept in sync');

    const rows = card.getByTestId('repository-row');
    const filter = card.getByTestId('ledger-filter');
    await filter.fill('bravo');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('repo-bravo');

    await filter.fill('zzz-none');
    await expect(card.getByTestId('ledger-no-match')).toContainText('zzz-none');
    await expect(rows).toHaveCount(0);

    await card.getByTestId('ledger-no-match').getByRole('button', { name: 'Clear filter' }).click();
    await expect(rows).toHaveCount(LEDGER_REPO_NAMES.length);
    await expect(filter).toHaveValue('');
  });

  test('creates one chatroom at a constant row height, then bulk creates the rest', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedLedgerMachine(page, 'e2e-ledger-create-host', 'e2e-ledger-create');
    const requestId = await createPendingRequest(seed);
    const card = await openExpandedCard(page, seed.machineId);
    await loadSnapshotThroughUi(card, seed, requestId);

    const rows = card.getByTestId('repository-row');
    const alpha = rows.filter({ hasText: 'repo-alpha' });
    expect((await alpha.boundingBox())?.height).toBe(ROW_HEIGHT);

    await alpha.getByRole('button', { name: 'Create chatroom' }).click();
    await expect(alpha).toHaveAttribute('data-has-chatroom', 'true', { timeout: 15_000 });
    await expect(alpha.getByRole('link', { name: 'Open' })).toBeVisible();
    expect((await alpha.boundingBox())?.height).toBe(ROW_HEIGHT);

    const bulk = card.getByTestId('bulk-create-open');
    await expect(bulk).toHaveText('Create chatrooms for 2 repositories');
    await bulk.click();
    const dialog = page.getByTestId('bulk-create-dialog');
    await expect(dialog.getByTestId('bulk-create-path')).toHaveCount(2);
    await dialog.getByTestId('bulk-create-confirm').click();
    await expect(dialog.getByTestId('bulk-create-summary')).toHaveText(
      'Created 2 · Skipped 0 · Failed 0',
      { timeout: 15_000 }
    );
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(
      card.locator('[data-testid="repository-row"][data-has-chatroom="true"]')
    ).toHaveCount(LEDGER_REPO_NAMES.length);
    await expect(card.getByTestId('bulk-create-done')).toHaveText(
      'Every repository shown has a chatroom.'
    );
    for (const row of await rows.all()) {
      expect((await row.boundingBox())?.height).toBe(ROW_HEIGHT);
    }
  });

  test('cancel returns the section to Load', async ({ authenticatedPage: page }) => {
    const seed = await seedLedgerMachine(page, 'e2e-ledger-cancel-host', 'e2e-ledger-cancel');
    const card = await openExpandedCard(page, seed.machineId);

    await card.getByTestId('ledger-load').click();
    await expect(card.getByTestId('ledger-asking')).toBeVisible();
    await card.getByTestId('ledger-asking').getByRole('button', { name: 'Cancel' }).click();
    await expect(card.getByTestId('ledger-load')).toBeVisible();
    await expect(card.getByTestId('ledger-asking')).toHaveCount(0);
  });

  test('collapsing the card discards the snapshot, so re-expanding asks again', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedLedgerMachine(page, 'e2e-ledger-discard-host', 'e2e-ledger-discard');
    const requestId = await createPendingRequest(seed);
    const card = await openExpandedCard(page, seed.machineId);
    await loadSnapshotThroughUi(card, seed, requestId);

    await card.getByTestId('machine-expander').click();
    await expect(card.getByTestId('machine-repositories-section')).toHaveCount(0);
    await expect
      .poll(() =>
        seed.client.query(api.repositoryLedger.get, { sessionId: seed.sessionId, requestId })
      )
      .toBeNull();

    await card.getByTestId('machine-expander').click();
    await expect(card.getByTestId('ledger-load')).toBeVisible();
    await expect(card.getByTestId('ledger-ready')).toHaveCount(0);
  });

  test('shows the omitted-entries banner when the daemon dropped entries', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedLedgerMachine(page, 'e2e-ledger-banner-host', 'e2e-ledger-banner');
    const requestId = await createPendingRequest(seed);
    const card = await openExpandedCard(page, seed.machineId);

    await loadSnapshotThroughUi(card, seed, requestId, 2);
    await expect(card.getByTestId('ledger-banner-omitted')).toContainText(
      '2 entries are left out of this snapshot'
    );
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

  test('keeps the bulk button full width and the bulk dialog inside the viewport', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedLedgerMachine(page, 'e2e-ledger-mobile-host', 'e2e-ledger-mobile');
    const requestId = await createPendingRequest(seed);
    const card = await openExpandedCard(page, seed.machineId);
    await loadSnapshotThroughUi(card, seed, requestId);

    const section = await card.getByTestId('machine-repositories-section').boundingBox();
    const bulk = card.getByTestId('bulk-create-open');
    const bulkBox = await bulk.boundingBox();
    if (!section || !bulkBox)
      throw new Error('the section and bulk button should have layout boxes');
    // Design: below `sm` the bulk button spans the section, not just its text.
    expect(bulkBox.width).toBeGreaterThanOrEqual(section.width * 0.9);
    expect(bulkBox.x + bulkBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);

    await bulk.click();
    const dialog = page.getByTestId('bulk-create-dialog');
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    if (!dialogBox) throw new Error('the bulk dialog should have a layout box');
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(hasHorizontalScroll).toBe(false);
  });
});
