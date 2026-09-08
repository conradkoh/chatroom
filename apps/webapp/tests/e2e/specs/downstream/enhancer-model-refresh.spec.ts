import { expect, test, devices } from '@playwright/test';

import { LoginPage } from '../../pages/login.page';
import { TAG_DOWNSTREAM } from '../../support/tags';

/**
 * Enhancer harness/model panel refresh control (backlog ps7d03gnrqchc3v86gb41rh4318dvxy8).
 *
 * Real Chromium flow: anonymous login → app shell → open the enhancer
 * configuration panel for a connected/linked machine → assert the shared
 * `MachineCapabilitiesRefreshButton` is visible beside the harness selector
 * with its accessible name/title → click it when enabled and assert the
 * existing refreshing/terminal feedback path → verify the control remains
 * present with the selector layout intact.
 *
 * Environment precondition: a seeded or existing chatroom with a connected
 * machine linked via the workspace registry and a running daemon. Ephemeral
 * CI backends and local checkouts without a daemon cannot satisfy this, so
 * the spec skips (rather than faking a result) when the enhancer entry point
 * or a refreshable machine is unavailable.
 */

test.use({ ...devices['Desktop Chrome'] });

test.describe('Enhancer model refresh', { tag: [TAG_DOWNSTREAM] }, () => {
  test('refresh control is visible in the enhancer harness panel and uses the existing refresh path', async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.loginAnonymously();

    // Enter a chatroom context. Anonymous dashboards land on /app; the
    // enhancer configuration lives behind the chatroom activity surface.
    await expect(page).toHaveURL(/\/app/);

    // Best-effort: find the enhancer configuration entry point. Selector
    // intent mirrors EnhancerActivityBarItem / PlannerConversationModeToggle.
    const enhancerEntry = page
      .getByRole('button', { name: /enhancer/i })
      .or(page.getByText('Enhancer configuration'));
    const entryVisible = await enhancerEntry
      .first()
      .isVisible()
      .catch(() => false);
    if (!entryVisible) {
      test.skip(
        true,
        'Enhancer configuration entry unavailable: needs a seeded chatroom ' +
          'with a connected machine linked via the workspace registry and a running daemon.'
      );
      return;
    }

    await enhancerEntry.first().click();

    const dialog = page.getByRole('dialog').filter({
      hasText: 'Enhancer configuration',
    });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // The harness/model panel lives inside the dialog form.
    await expect(dialog.getByText('Agent harness')).toBeVisible();

    const refreshButton = dialog.getByTestId('machine-capabilities-refresh-button');
    const refreshVisible = await refreshButton.isVisible().catch(() => false);
    if (!refreshVisible) {
      // No machine selected (empty-state helper) or machine offline/unlinked
      // rendering path: the control is only present with a selected machine.
      test.skip(
        true,
        'Enhancer refresh control not present: no machine selected, or the ' +
          'selected machine is offline/unlinked (daemon + workspace linkage required).'
      );
      return;
    }

    // Visible with the shared accessible contract from
    // MachineCapabilitiesRefreshButton (aria-label + explanatory title).
    await expect(refreshButton).toHaveAttribute(
      'aria-label',
      /Refresh harness and model list|Harness and model discovery finished/
    );
    const title = await refreshButton.getAttribute('title');
    expect(title).toBeTruthy();

    // Selector layout must remain intact beside the control.
    await expect(dialog.getByText('Model')).toBeVisible();
    await expect(refreshButton).toBeVisible();

    if (await refreshButton.isEnabled()) {
      await refreshButton.click();
      // Existing feedback path: requesting spinner/disabled state, cooldown
      // hint, success tick, or error hint — any terminal inline feedback
      // proves the shared requestCapabilitiesRefresh flow ran.
      await expect
        .poll(
          async () => {
            const disabled = await refreshButton.isDisabled().catch(() => false);
            const label = await refreshButton.getAttribute('aria-label');
            const hintVisible = await dialog
              .locator('[aria-live="polite"]')
              .isVisible()
              .catch(() => false);
            return (
              disabled ||
              label !== 'Refresh harness and model list from this machine' ||
              hintVisible
            );
          },
          { timeout: 15_000 }
        )
        .toBe(true);
    } else {
      // Disabled affordance must explain why (offline / unlinked / cooldown).
      expect(title).toMatch(/workspace|daemon|Wait|Refreshing|finished|Refresh harness/i);
    }

    // Control remains present with the selector layout intact after interaction.
    await expect(refreshButton).toBeVisible();
    await expect(dialog.getByText('Agent harness')).toBeVisible();
    await expect(dialog.getByText('Model')).toBeVisible();
  });
});
