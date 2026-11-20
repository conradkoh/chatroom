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

interface RelativeUnit {
  /** Upper bound (exclusive) in seconds before the next unit takes over. */
  limitSeconds: number;
  secondsPerUnit: number;
  unit: Intl.RelativeTimeFormatUnit;
}

const RELATIVE_UNITS: readonly RelativeUnit[] = [
  { limitSeconds: 60 * 60, secondsPerUnit: 60, unit: 'minute' },
  { limitSeconds: 24 * 60 * 60, secondsPerUnit: 60 * 60, unit: 'hour' },
  { limitSeconds: 30 * 24 * 60 * 60, secondsPerUnit: 24 * 60 * 60, unit: 'day' },
  { limitSeconds: 365 * 24 * 60 * 60, secondsPerUnit: 30 * 24 * 60 * 60, unit: 'month' },
];

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

/**
 * Relative "last seen" text. < 60 s (or a clock-skewed future time) → 'just now'.
 * Units: minutes (<60), hours (<24), days (<30), months (<12), years.
 */
export function formatLastSeen(lastSeenAt: number, now: number): string {
  const elapsedSeconds = Math.floor((now - lastSeenAt) / 1000);
  if (elapsedSeconds < 60) return 'just now';

  const unit = RELATIVE_UNITS.find((candidate) => elapsedSeconds < candidate.limitSeconds);
  if (!unit) {
    return RELATIVE_TIME_FORMAT.format(-Math.floor(elapsedSeconds / SECONDS_PER_YEAR), 'year');
  }

  return RELATIVE_TIME_FORMAT.format(-Math.floor(elapsedSeconds / unit.secondsPerUnit), unit.unit);
}

/** 'Nov 3, 2026' (en-US, month short, day numeric, year numeric). */
export function formatRegisteredDate(registeredAt: number): string {
  return new Date(registeredAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function countLabel(count: number, unit: string, capped: boolean): string {
  const plural = capped || count !== 1 ? 's' : '';
  const plus = capped ? '+' : '';
  return `${count}${plus} ${unit}${plural}`;
}

/** '3 workspaces · 2 chatrooms'; capped counts keep plurals and gain a '+' suffix. */
export function formatUsageSummary(usage: {
  activeWorkspaceCount: number;
  activeChatroomCount: number;
  capped: boolean;
}): string {
  const workspaces = countLabel(usage.activeWorkspaceCount, 'workspace', usage.capped);
  const chatrooms = countLabel(usage.activeChatroomCount, 'chatroom', usage.capped);
  return `${workspaces} · ${chatrooms}`;
}

function compareMachines(a: UserMachine, b: UserMachine): number {
  const byName = getMachineDisplayName(a).localeCompare(getMachineDisplayName(b), undefined, {
    sensitivity: 'base',
  });
  if (byName !== 0) return byName;

  const byRegisteredAt = a.registeredAt - b.registeredAt;
  if (byRegisteredAt !== 0) return byRegisteredAt;

  return a.machineId.localeCompare(b.machineId);
}

/**
 * New array sorted by display name (case-insensitive), then registeredAt, then machineId.
 * Status/connectivity are deliberately excluded so heartbeats never reshuffle cards.
 */
export function sortMachinesByDisplayName(machines: readonly UserMachine[]): UserMachine[] {
  return [...machines].sort(compareMachines);
}
