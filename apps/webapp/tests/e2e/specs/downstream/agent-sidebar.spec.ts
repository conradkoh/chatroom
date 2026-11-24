import type { Locator, Page } from '@playwright/test';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { ConvexHttpClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { expect, test } from '../../fixtures/auth.fixture';
import { getConvexUrl } from '../../support/env';
import { TAG_DOWNSTREAM } from '../../support/tags';

const CANONICAL_TEAMS = [
  {
    teamId: 'duo',
    teamStructureId: 'duo@1',
    roles: [
      'planner',
      'product-manager',
      'architect',
      'researcher',
      'triage',
      'reviewer',
      'uiux-engineer',
      'game-asset-designer',
      'verifier',
      'builder',
    ],
    permanentRoles: ['planner', 'builder'],
    ephemeralRoles: [
      'product-manager',
      'architect',
      'researcher',
      'triage',
      'reviewer',
      'uiux-engineer',
      'game-asset-designer',
      'verifier',
    ],
  },
  {
    teamId: 'solo',
    teamStructureId: 'solo@1',
    roles: ['solo', 'product-manager', 'architect', 'triage', 'uiux-engineer', 'verifier'],
    permanentRoles: ['solo'],
    ephemeralRoles: ['product-manager', 'architect', 'triage', 'uiux-engineer', 'verifier'],
  },
  {
    teamId: 'trio',
    teamStructureId: 'trio@1',
    roles: [
      'coordinator',
      'product-manager',
      'architect',
      'researcher',
      'triage',
      'reviewer',
      'uiux-engineer',
      'game-asset-designer',
      'verifier',
      'specifier',
      'builder',
    ],
    permanentRoles: ['coordinator', 'specifier', 'builder'],
    ephemeralRoles: [
      'product-manager',
      'architect',
      'researcher',
      'triage',
      'reviewer',
      'uiux-engineer',
      'game-asset-designer',
      'verifier',
    ],
  },
] as const;

type CanonicalTeam = (typeof CANONICAL_TEAMS)[number];

function agentsSection(page: Page) {
  return page.getByText(/^Agents \(\d+\)$/).locator('xpath=ancestor::section[1]');
}

function offlineRoleButtons(section: Locator) {
  return section.getByRole('button', {
    name: /^[\w-]+: OFFLINE\. Click to configure\.$/,
  });
}

function ephemeralGroupToggle(section: Locator) {
  return section.getByTestId('ephemeral-agent-group-toggle');
}

async function dismissSetupWorkspace(page: Page): Promise<void> {
  const setupWorkspaceDialog = page.getByRole('dialog');
  await expect(
    setupWorkspaceDialog.getByRole('heading', { name: 'Setup Workspace' })
  ).toBeVisible();
  await setupWorkspaceDialog.getByRole('button', { name: 'Close' }).click();
  await expect(setupWorkspaceDialog).toHaveCount(0);
}

/** Member rows only render while expanded; order is permanent rows then ephemeral members. */
async function assertExpandedRoleOrder(section: Locator, team: CanonicalTeam): Promise<void> {
  await expect(offlineRoleButtons(section)).toHaveCount(team.roles.length);
  expect(
    await offlineRoleButtons(section).evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label'))
    )
  ).toEqual(
    [...team.permanentRoles, ...team.ephemeralRoles].map(
      (role) => `${role}: OFFLINE. Click to configure.`
    )
  );
}

async function assertCollapsedSidebar(section: Locator, team: CanonicalTeam): Promise<void> {
  await expect(section.getByText(`Agents (${team.roles.length})`, { exact: true })).toBeVisible();
  // Collapsed: only permanent rows are role buttons.
  const roleButtons = offlineRoleButtons(section);
  await expect(roleButtons).toHaveCount(team.permanentRoles.length);
  expect(
    await roleButtons.evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label')))
  ).toEqual(team.permanentRoles.map((role) => `${role}: OFFLINE. Click to configure.`));

  const n = team.ephemeralRoles.length;
  await expect(section.getByText(`Ephemeral (${n})`, { exact: true })).toBeVisible();
  await expect(section.getByText('0 online', { exact: true })).toBeVisible();
  await expect(section.getByText(`${n} offline`, { exact: true })).toBeVisible();
  await expect(section.getByText('0 errored', { exact: true })).toBeVisible();

  const toggle = ephemeralGroupToggle(section);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(await toggle.getAttribute('aria-controls')).toBeNull();
  await expect(toggle).toHaveAccessibleName(
    `Ephemeral (${n}): 0 online, ${n} offline, 0 errored. Show group.`
  );
  await expect(section.getByTestId('ephemeral-agent-group-body')).toHaveCount(0);
}

async function expandEphemeralGroup(section: Locator, team: CanonicalTeam): Promise<void> {
  const toggle = ephemeralGroupToggle(section);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAccessibleName(
    `Ephemeral (${team.ephemeralRoles.length}): 0 online, ${team.ephemeralRoles.length} offline, 0 errored. Hide group.`
  );
  // aria-controls must point at the rendered body. Resolve it by id, not by a CSS selector (React ids are not CSS-safe).
  const bodyTestId = await toggle.evaluate((el) =>
    document.getElementById(el.getAttribute('aria-controls') ?? '')?.getAttribute('data-testid')
  );
  expect(bodyTestId).toBe('ephemeral-agent-group-body');
  await assertExpandedRoleOrder(section, team);
}

async function collapseEphemeralGroup(section: Locator): Promise<void> {
  const toggle = ephemeralGroupToggle(section);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(section.getByTestId('ephemeral-agent-group-body')).toHaveCount(0);
}

async function assertSidebarRoles(page: Page, team: CanonicalTeam): Promise<void> {
  const section = agentsSection(page);
  await assertCollapsedSidebar(section, team);
  await expect(section.getByText(/View More/i)).toHaveCount(0);
  await expect(section.getByRole('button', { name: /^enhancer:/i })).toHaveCount(0);
}

async function verifyBackendStructure(
  client: ConvexHttpClient,
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  team: CanonicalTeam
): Promise<void> {
  const structure = await client.query(api.chatrooms.getTeamStructureForChatroom, {
    sessionId,
    chatroomId,
  });
  expect(structure).not.toBeNull();
  if (!structure) throw new Error(`No active structure for ${team.teamId}`);

  const statuses = await client.query(api.agents.listStatus, {
    sessionId,
    chatroomId,
  });
  expect(structure.teamId).toBe(team.teamId);
  expect(structure.teamStructureId).toBe(team.teamStructureId);
  expect(structure.roles.map(({ role }) => role)).toEqual(team.roles);
  expect(
    structure.roles.filter(({ lifecycle }) => lifecycle === 'permanent').map(({ role }) => role)
  ).toEqual(team.permanentRoles);
  expect(
    structure.roles.filter(({ lifecycle }) => lifecycle === 'ephemeral').map(({ role }) => role)
  ).toEqual(team.ephemeralRoles);
  expect(statuses.map(({ role }) => role)).toEqual(team.roles);
  expect(statuses.every(({ status }) => status === 'offline')).toBe(true);
  expect(
    statuses.filter(({ roleKind }) => roleKind === 'persistent').map(({ role }) => role)
  ).toEqual(team.permanentRoles);
  expect(
    statuses.filter(({ roleKind }) => roleKind === 'ephemeral').map(({ role }) => role)
  ).toEqual(team.ephemeralRoles);
}

test.describe('Right sidebar scrolls as a single container', { tag: [TAG_DOWNSTREAM] }, () => {
  test.use({ viewport: { width: 1440, height: 800 } });

  test('keeps the full task list reachable at a short viewport', async ({
    authenticatedPage: page,
  }) => {
    const rawSessionId = await page.evaluate(() => localStorage.getItem('sessionId'));
    expect(rawSessionId, 'anonymous login should persist a session').toBeTruthy();
    const sessionId = rawSessionId as SessionId;
    const client = new ConvexHttpClient(getConvexUrl());
    const chatroomId = await client.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'duo@1',
    });

    await page.goto(`/app/chatroom?id=${chatroomId}`);
    await dismissSetupWorkspace(page);

    // The collapsed ephemeral group leaves the sidebar shorter than this viewport.
    // Expand it so the sidebar carries its full row density and must scroll.
    await ephemeralGroupToggle(agentsSection(page)).click();
    await expect(ephemeralGroupToggle(agentsSection(page))).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    const sidebar = page.getByTestId('agent-sidebar');
    await expect(sidebar).toBeVisible();

    // 1. The sidebar is the single scroll container and its content overflows it.
    const scrollInfo = await sidebar.evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scrollInfo.overflowY).toBe('auto');
    expect(scrollInfo.scrollHeight).toBeGreaterThan(scrollInfo.clientHeight);

    // 2. Agent rows do not squeeze the Current section header to zero height.
    const currentHeader = sidebar.getByText(/^Current \(\d+\)$/);
    await expect(currentHeader).toBeVisible();
    const currentBox = await currentHeader.boundingBox();
    expect(currentBox).not.toBeNull();
    expect(currentBox?.height ?? 0).toBeGreaterThan(0);

    // 3. Scrolling the sidebar to the bottom makes the Backlog header reachable
    // while the Agents header scrolls off the top of the viewport.
    await sidebar.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const innerHeight = await page.evaluate(() => window.innerHeight);

    const backlogHeader = sidebar.getByText(/^Backlog \(\d+\)$/);
    const backlogBox = await backlogHeader.boundingBox();
    expect(backlogBox).not.toBeNull();
    expect(backlogBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((backlogBox?.y ?? 0) + (backlogBox?.height ?? 0)).toBeLessThanOrEqual(innerHeight);

    const agentsHeader = sidebar.getByText(/^Agents \(\d+\)$/);
    const agentsBox = await agentsHeader.boundingBox();
    expect(agentsBox).not.toBeNull();
    expect(agentsBox?.y ?? 0).toBeLessThan(0);

    // 4. The WorkQueue no longer nests its own scroll area.
    const workQueueRoot = backlogHeader.locator(
      'xpath=ancestor::section[1]/parent::div/parent::div'
    );
    const nestedScrollContainers = await workQueueRoot.evaluate(
      (root) =>
        Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => {
          const overflowY = getComputedStyle(el).overflowY;
          return overflowY === 'auto' || overflowY === 'scroll';
        }).length
    );
    expect(nestedScrollContainers).toBe(0);
  });
});

test.describe('Builtin agent sidebar', { tag: [TAG_DOWNSTREAM] }, () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  for (const team of CANONICAL_TEAMS) {
    test(`shows every ${team.teamId} role offline without workspace configuration`, async ({
      authenticatedPage: page,
    }) => {
      const rawSessionId = await page.evaluate(() => localStorage.getItem('sessionId'));
      expect(rawSessionId, 'anonymous login should persist a session').toBeTruthy();
      const sessionId = rawSessionId as SessionId;
      const client = new ConvexHttpClient(getConvexUrl());
      const chatroomId = await client.mutation(api.chatrooms.create, {
        sessionId,
        teamStructureId: team.teamStructureId,
      });

      expect(
        await client.query(api.agents.listLastSentLaunchRequests, { sessionId, chatroomId })
      ).toEqual([]);
      await verifyBackendStructure(client, sessionId, chatroomId, team);

      await page.goto(`/app/chatroom?id=${chatroomId}`);
      await dismissSetupWorkspace(page);
      await assertSidebarRoles(page, team);

      // Ephemeral agents are collapsed by default; expanding reveals them in team order.
      await expandEphemeralGroup(agentsSection(page), team);

      await page.getByTestId('agent-sidebar-row-triage').click();
      const configModal = page.getByTestId('agent-config-modal');
      await expect(configModal).toBeVisible();
      await expect(page.getByTestId('agent-config-modal-role')).toHaveText('triage');
      await configModal.getByRole('button', { name: 'Close' }).click();
      await expect(configModal).toHaveCount(0);

      expect(
        await client.query(api.agents.listLastSentLaunchRequests, { sessionId, chatroomId })
      ).toEqual([]);

      // Expansion persists per chatroom across a reload.
      await page.reload();
      await dismissSetupWorkspace(page);
      await expect(ephemeralGroupToggle(agentsSection(page))).toHaveAttribute(
        'aria-expanded',
        'true'
      );
      await assertExpandedRoleOrder(agentsSection(page), team);

      // Collapsing persists too: the group comes back collapsed after another reload.
      await collapseEphemeralGroup(agentsSection(page));
      await page.reload();
      await dismissSetupWorkspace(page);
      await assertSidebarRoles(page, team);

      await verifyBackendStructure(client, sessionId, chatroomId, team);
      expect(
        await client.query(api.agents.listLastSentLaunchRequests, { sessionId, chatroomId })
      ).toEqual([]);
    });
  }
});
