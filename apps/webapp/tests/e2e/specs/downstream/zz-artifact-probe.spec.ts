import { expect, test } from '@playwright/test';

import { TAG_DOWNSTREAM } from '../../support/tags';

// Temporary probe: fails on purpose so the CI failure-artifact steps have a real
// failing run to upload from. Reverted in the follow-up commit.
test('artifact probe', { tag: TAG_DOWNSTREAM }, () => {
  expect(1).toBe(2);
});
