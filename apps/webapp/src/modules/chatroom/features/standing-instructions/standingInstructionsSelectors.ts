// fallow-ignore-file unused-file
/**
 * Standing-instructions selector SSOT.
 *
 * CSS selectors used by workflow/E2E reporting to target the standing
 * instructions bar states and add-flow entry points. Keep in sync with the
 * `data-testid` attributes in the standing-instructions UI.
 */

/** CSS selector for the active standing-instructions bar (has content, enabled). */
export const STANDING_INSTRUCTIONS_ACTIVE_BAR_SELECTOR =
  '[data-testid="standing-instructions-active-bar"]';

/** CSS selector for the disabled standing-instructions bar (has content, disabled). */
export const STANDING_INSTRUCTIONS_DISABLED_BAR_SELECTOR =
  '[data-testid="standing-instructions-disabled-bar"]';

/** CSS selector for the add-standing-instructions entry (no content yet). */
export const STANDING_INSTRUCTIONS_ADD_BAR_SELECTOR =
  '[data-testid="standing-instructions-add-bar"]';

/** CSS selector for the create-new standing instruction button inside add flow. */
export const STANDING_INSTRUCTIONS_CREATE_NEW_SELECTOR =
  '[data-testid="standing-instructions-create-new"]';
