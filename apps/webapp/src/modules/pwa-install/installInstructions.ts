import type { InstallInstructions, InstallPlatform } from './types';

// Public data map — consumed via getInstructionsForPlatform / DIALOG_TAB_GROUPS.
// fallow-ignore-next-line unused-export
export const INSTALL_INSTRUCTIONS: Record<
  Exclude<InstallPlatform, 'already-installed'>,
  InstallInstructions
> = {
  'ios-safari': {
    platform: 'ios-safari',
    label: 'iPhone / iPad (Safari)',
    steps: [
      'Open this page in Safari (required for installation on iOS).',
      'Tap the Share button (square with arrow).',
      'Scroll down and tap "Add to Home Screen".',
      'Tap "Add" to confirm.',
    ],
  },
  'ios-other': {
    platform: 'ios-other',
    label: 'iPhone / iPad (Chrome, Firefox, etc.)',
    note: 'PWA installation on iOS requires Safari. Open this page in Safari to continue.',
    steps: [
      'Copy this page URL or tap the browser menu.',
      'Choose "Open in Safari" (or paste the URL in Safari).',
      'In Safari, tap the Share button.',
      'Tap "Add to Home Screen", then tap "Add".',
    ],
  },
  'android-chrome': {
    platform: 'android-chrome',
    label: 'Android (Chrome)',
    steps: [
      'Tap the menu button (three dots) in the top-right.',
      'Tap "Install app" or "Add to Home screen".',
      'Follow the prompts to confirm.',
    ],
  },
  'android-other': {
    platform: 'android-other',
    label: 'Android (other browsers)',
    steps: [
      'Open the browser menu.',
      'Look for "Add to Home screen" or "Install".',
      'Follow the prompts to confirm.',
    ],
  },
  'desktop-chrome': {
    platform: 'desktop-chrome',
    label: 'Desktop (Chrome)',
    steps: [
      'Look for the install icon in the address bar (monitor with arrow).',
      'Click "Install" in the popup.',
      'Alternatively: use the browser menu → "Install app…".',
    ],
  },
  'desktop-edge': {
    platform: 'desktop-edge',
    label: 'Desktop (Edge)',
    steps: [
      'Click the install icon in the address bar, or',
      'Open the menu (⋯) → Apps → "Install this site as an app".',
    ],
  },
  'desktop-safari': {
    platform: 'desktop-safari',
    label: 'Desktop (Safari)',
    steps: ['In Safari, open the File menu.', 'Choose "Add to Dock" (macOS Sonoma or later).'],
  },
  'desktop-other': {
    platform: 'desktop-other',
    label: 'Desktop (other browsers)',
    steps: [
      'Check your browser menu for "Install" or "Add to Home screen".',
      'Not all desktop browsers support PWA installation.',
    ],
  },
};

export const DIALOG_TAB_GROUPS = {
  ios: ['ios-safari', 'ios-other'] as const,
  android: ['android-chrome', 'android-other'] as const,
  desktop: ['desktop-chrome', 'desktop-edge', 'desktop-safari', 'desktop-other'] as const,
};

export function getInstructionsForPlatform(
  platform: Exclude<InstallPlatform, 'already-installed'>,
  appName = 'App'
): InstallInstructions {
  const base = INSTALL_INSTRUCTIONS[platform];
  if (platform === 'desktop-chrome') {
    return {
      ...base,
      steps: [...base.steps.slice(0, 2), `Alternatively: menu (⋮) → "Install ${appName}…".`],
    };
  }
  return base;
}
