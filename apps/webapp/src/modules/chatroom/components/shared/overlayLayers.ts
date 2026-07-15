/**
 * Overlay z-index layer constants (Tailwind classes).
 * See docs/application/design/theme.md § Overlay stacking.
 *
 * Rule: portaled float UI (menus, drawers) inside modals MUST use Z_FLOATING.
 */

/** Mobile chrome scrims, light layout overlays (e.g. ChatroomDashboard mobile backdrop) */
export const Z_LAYOUT_CHROME = 'z-30';

/** Side panels, light backdrops (e.g. timeline mobile panel) */
export const Z_PANEL = 'z-40';

/** Base modals/dialogs — matches FixedModal BASE_MODAL_Z_INDEX (50) */
export const Z_MODAL = 'z-50';

/**
 * Portaled float layer — menus, popovers, drawers above modals.
 * FixedModal stacks to 60+ via inline style; float layer must be higher.
 */
export const Z_FLOATING = 'z-[100]';
