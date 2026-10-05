import type { Locator, Page } from '@playwright/test';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
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

const CANONICAL_TEAMS = [
  {
    teamId: 'duo',
    teamStructureId: 'duo@1',
    roles: ['planner', 'architect', 'triage', 'uiux-engineer', 'builder'],
    permanentRoles: ['planner', 'builder'],
    ephemeralRoles: ['architect', 'triage', 'uiux-engineer'],
  },
  {
    teamId: 'solo',
    teamStructureId: 'solo@1',
    roles: ['solo', 'architect', 'triage', 'uiux-engineer'],
    permanentRoles: ['solo'],
    ephemeralRoles: ['architect', 'triage', 'uiux-engineer'],
  },
] as const;

type CanonicalTeam = (typeof CANONICAL_TEAMS)[number];

function agentsSection(page: Page) {
  return page.getByText(/^Agents \(\d+\)$/).locator('xpath=ancestor::section[1]');
}

function offlineRoleButtons(section: Locator) {
  return section.getByRole('button', {
    name: /^[\w-]+: OFFLINE\. Click to view all agents\.$/,
  });
}

async function dismissSetupWorkspace(page: Page): Promise<void> {
  const setupWorkspaceDialog = page.getByRole('dialog');
  await expect(
    setupWorkspaceDialog.getByRole('heading', { name: 'Setup Workspace' })
  ).toBeVisible();
  await setupWorkspaceDialog.getByRole('button', { name: 'Close' }).click();
  await expect(setupWorkspaceDialog).toHaveCount(0);
}

async function assertAllSidebarRows(section: Locator, team: CanonicalTeam): Promise<void> {
  await expect(section.getByText(`Agents (${team.roles.length})`, { exact: true })).toBeVisible();
  const roleButtons = offlineRoleButtons(section);
  await expect(roleButtons).toHaveCount(team.roles.length);
  const accessibleNames = await roleButtons.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('aria-label'))
  );
  expect(accessibleNames).toEqual(
    [...team.permanentRoles, ...team.ephemeralRoles].map(
      (role) => `${role}: OFFLINE. Click to view all agents.`
    )
  );

  for (const role of team.roles) {
    const row = section.getByRole('button', {
      name: `${role}: OFFLINE. Click to view all agents.`,
      exact: true,
    });
    await expect(row).toHaveCount(1);
    await expect(row).toBeVisible();
  }
}

async function assertEphemeralSidebarGroup(section: Locator, team: CanonicalTeam): Promise<void> {
  const ephemeralHeading = section.getByText(`Ephemeral (${team.ephemeralRoles.length})`, {
    exact: true,
  });
  await expect(ephemeralHeading).toBeVisible();
  const ephemeralRows = ephemeralHeading.locator(
    'xpath=following-sibling::div[.//*[@role="button"]]'
  );
  const ephemeralButtons = ephemeralRows.getByRole('button', {
    name: /^[\w-]+: OFFLINE\. Click to view all agents\.$/,
  });
  await expect(ephemeralButtons).toHaveCount(team.ephemeralRoles.length);
  expect(
    await ephemeralButtons.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label'))
    )
  ).toEqual(team.ephemeralRoles.map((role) => `${role}: OFFLINE. Click to view all agents.`));

  const permanentRowsBeforeHeading = await ephemeralHeading.evaluate((heading) => {
    const section = heading.closest('section');
    if (!section) return 0;
    return Array.from(
      section.querySelectorAll<HTMLElement>(
        '[role="button"][aria-label$="Click to view all agents."]'
      )
    ).filter((row) =>
      Boolean(row.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).length;
  });
  expect(permanentRowsBeforeHeading).toBe(team.permanentRoles.length);
}

async function assertSidebarRoles(page: Page, team: CanonicalTeam): Promise<void> {
  const section = agentsSection(page);
  await assertAllSidebarRows(section, team);
  await assertEphemeralSidebarGroup(section, team);
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
      expect(
        await client.query(api.agents.listLastSentLaunchRequests, { sessionId, chatroomId })
      ).toEqual([]);

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
