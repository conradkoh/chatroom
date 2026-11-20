import { getMachineDisplayName, type UserMachine } from '../../../types/machine';

/** 'darwin' → 'macOS', 'linux' → 'Linux', 'win32' → 'Windows'; anything else is shown raw. */
export function formatOs(os: string): string {
  switch (os) {
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    case 'win32':
      return 'Windows';
    default:
      return os;
  }
}

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/**
 * Relative "last seen" text. < 60 s (or a clock-skewed future time) → 'just now'.
 * Units: minutes (<60), hours (<24), days (<30), months (<12), years.
 */
export function formatLastSeen(lastSeenAt: number, now: number): string {
  const elapsedMs = now - lastSeenAt;
  if (elapsedMs < 0) return 'just now';

  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return RELATIVE_TIME_FORMAT.format(-minutes, 'minute');

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return RELATIVE_TIME_FORMAT.format(-hours, 'hour');

  const days = Math.floor(hours / 24);
  if (days < 30) return RELATIVE_TIME_FORMAT.format(-days, 'day');

  const months = Math.floor(days / 30);
  if (months < 12) return RELATIVE_TIME_FORMAT.format(-months, 'month');

  return RELATIVE_TIME_FORMAT.format(-Math.floor(days / 365), 'year');
}

/** 'Nov 3, 2026' (en-US, month short, day numeric, year numeric). */
export function formatRegisteredDate(registeredAt: number): string {
  return new Date(registeredAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** '3 workspaces · 2 chatrooms'; capped counts keep plurals and gain a '+' suffix. */
export function formatUsageSummary(usage: {
  activeWorkspaceCount: number;
  activeChatroomCount: number;
  capped: boolean;
}): string {
  const plus = usage.capped ? '+' : '';
  const workspacePlural = usage.capped || usage.activeWorkspaceCount !== 1 ? 's' : '';
  const chatroomPlural = usage.capped || usage.activeChatroomCount !== 1 ? 's' : '';
  return `${usage.activeWorkspaceCount}${plus} workspace${workspacePlural} · ${usage.activeChatroomCount}${plus} chatroom${chatroomPlural}`;
}

/**
 * New array sorted by display name (case-insensitive), then registeredAt, then machineId.
 * Status/connectivity are deliberately excluded so heartbeats never reshuffle cards.
 */
export function sortMachinesByDisplayName(machines: readonly UserMachine[]): UserMachine[] {
  return [...machines].sort((a, b) => {
    const byName = getMachineDisplayName(a).localeCompare(getMachineDisplayName(b), undefined, {
      sensitivity: 'base',
    });
    if (byName !== 0) return byName;
    if (a.registeredAt !== b.registeredAt) return a.registeredAt - b.registeredAt;
    if (a.machineId === b.machineId) return 0;
    return a.machineId < b.machineId ? -1 : 1;
  });
}
