/** Module-level store for command palette open state — avoids ChatroomDashboard context rerender. */

type Listener = () => void;

let paletteOpen = false;
let paletteRunsActive = false;
const openListeners = new Set<Listener>();
const runsActiveListeners = new Set<Listener>();
let runsActiveTimer: ReturnType<typeof setTimeout> | null = null;

const RUNS_ACTIVE_DELAY_MS = 100;

function notifyOpen() {
  openListeners.forEach((l) => l());
}

function notifyRunsActive() {
  runsActiveListeners.forEach((l) => l());
}

function clearRunsActiveTimer() {
  if (runsActiveTimer !== null) {
    clearTimeout(runsActiveTimer);
    runsActiveTimer = null;
  }
}

export function getCommandPaletteOpen(): boolean {
  return paletteOpen;
}

export function subscribeCommandPaletteOpen(listener: Listener): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

export function getCommandPaletteRunsActive(): boolean {
  return paletteRunsActive;
}

export function subscribeCommandPaletteRunsActive(listener: Listener): () => void {
  runsActiveListeners.add(listener);
  return () => runsActiveListeners.delete(listener);
}

/** Set palette open. Schedules deferred runsActive when opening. */
export function setCommandPaletteOpen(open: boolean): void {
  if (paletteOpen === open) return;
  paletteOpen = open;
  notifyOpen();

  clearRunsActiveTimer();
  if (!open) {
    if (paletteRunsActive) {
      paletteRunsActive = false;
      notifyRunsActive();
    }
    return;
  }

  runsActiveTimer = setTimeout(() => {
    runsActiveTimer = null;
    if (!paletteOpen) return;
    if (!paletteRunsActive) {
      paletteRunsActive = true;
      notifyRunsActive();
    }
  }, RUNS_ACTIVE_DELAY_MS);
}

export function toggleCommandPaletteOpen(): void {
  setCommandPaletteOpen(!paletteOpen);
}

/** Reset palette state (route change). */
export function resetCommandPalette(): void {
  clearRunsActiveTimer();
  const wasOpen = paletteOpen;
  const wasRunsActive = paletteRunsActive;
  paletteOpen = false;
  paletteRunsActive = false;
  if (wasOpen) notifyOpen();
  if (wasRunsActive) notifyRunsActive();
}

/** Subscribe to any command dialog close (palette or context). For focus-return effect. */
const anyCloseListeners = new Set<Listener>();

export function subscribeCommandDialogAnyClose(listener: Listener): () => void {
  anyCloseListeners.add(listener);
  return () => anyCloseListeners.delete(listener);
}

export function notifyCommandDialogClosed(): void {
  anyCloseListeners.forEach((l) => l());
}
