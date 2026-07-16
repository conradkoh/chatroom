/**
 * Overlay z-index layer constants (Tailwind classes).
 * See docs/application/design/theme.md § Overlay stacking.
 *
 * All modals, dialogs, and portaled menus use a single z-50 band.
 * Stacking order is determined by DOM portal order — later-portaled
 * elements render on top of earlier ones at equal z-index.
 */

/** Mobile chrome scrims, light layout overlays (e.g. ChatroomDashboard mobile backdrop) */
export const Z_LAYOUT_CHROME = 'z-30';

/** Side panels, light backdrops (e.g. timeline mobile panel) */
export const Z_PANEL = 'z-40';

/** Base modals/dialogs and portaled menus — stacking via portal DOM order */
export const Z_MODAL = 'z-50';
