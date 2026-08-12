/**
 * Overlay z-index layer constants (Tailwind classes).
 * See docs/application/design/theme.md § Overlay stacking.
 *
 * Tier system:
 * - Z_MODAL (z-50): base modals, portaled menus (menus elevate via portal host z-[60] inside modals)
 * - Mobile agent sidebar tiers sit between Z_MODAL and Z_FLOATING to cover the jump-to-new-messages chip.
 * - Z_FLOATING (z-[100]): nested modals/dialogs above parent modal (auto-elevated in portal context)
 * - Z_CONFIRMATION (z-[110]): alert/confirm dialogs above floating menus
 */

/** Mobile chrome scrims, light layout overlays (e.g. ChatroomDashboard mobile backdrop) */
export const Z_LAYOUT_CHROME = 'z-30';

/** Side panels, light backdrops (e.g. timeline mobile panel) */
export const Z_PANEL = 'z-40';

/** Base modals/dialogs and portaled menus — stacking via portal DOM order */
export const Z_MODAL = 'z-50';

/** Mobile agent sidebar backdrop — must cover jump-to-new-messages chip (z-50). */
export const Z_AGENT_SIDEBAR_MOBILE_BACKDROP = Z_MODAL; // z-50

/** Mobile agent sidebar panel — must stack above backdrop and jump chip. */
export const Z_AGENT_SIDEBAR_MOBILE_PANEL = 'z-[55]';

/** Nested modals/dialogs above parent modal — auto-elevated in portal context */
export const Z_FLOATING = 'z-[100]';

/** Alert/confirm dialogs above floating menus and nested modals */
export const Z_CONFIRMATION = 'z-[110]';
