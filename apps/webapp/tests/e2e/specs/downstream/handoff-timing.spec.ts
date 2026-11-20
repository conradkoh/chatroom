import { expect, test } from '@playwright/test';

import { TAG_DOWNSTREAM } from '../../support/tags';

test.describe('Timeline handoff timing', { tag: [TAG_DOWNSTREAM] }, () => {
  test('shows timing beside the existing timestamp only for handoffs', async ({ page }) => {
    await page.goto('/test/timeline-handoff-timing');

    const handoff = page.getByTestId('handoff-timing-fixture');
    const duration = handoff.getByTestId('timeline-handoff-duration');
    await expect(duration).toHaveText('1m 2s');
    await expect(duration).toHaveAttribute('title', 'Time since previous message: 1m 2s');
    await expect(handoff.getByTestId('timeline-message-footer')).toContainText(
      '15th November 2023'
    );

    await expect(
      page.getByTestId('ordinary-message-fixture').getByTestId('timeline-handoff-duration')
    ).toHaveCount(0);
  });

  test('marks a handoff that is much slower than typical with the slow tone', async ({ page }) => {
    await page.goto('/test/timeline-handoff-timing');

    const duration = page
      .getByTestId('handoff-timing-slow-fixture')
      .getByTestId('timeline-handoff-duration');
    await expect(duration).toBeVisible();
    await expect(duration).toHaveText('7m 0s');
    await expect(duration).toHaveAttribute('data-duration-tone', 'slow');
    await expect(duration).toHaveAttribute('title', /\(much longer than typical in this view\)$/);
  });
});
