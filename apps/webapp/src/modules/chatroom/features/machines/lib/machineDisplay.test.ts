import { describe, expect, it } from 'vitest';

import {
  formatLastSeen,
  formatOs,
  formatRegisteredDate,
  formatUsageSummary,
  sortMachinesByDisplayName,
} from './machineDisplay';
import type { UserMachine } from '../../../types/machine';

function machine(overrides: Partial<UserMachine> & { machineId: string }): UserMachine {
  return {
    hostname: 'host',
    os: 'darwin',
    registeredAt: 0,
    ...overrides,
  };
}

describe('formatOs', () => {
  it('maps known platforms to friendly labels', () => {
    expect(formatOs('darwin')).toBe('macOS');
    expect(formatOs('linux')).toBe('Linux');
    expect(formatOs('win32')).toBe('Windows');
  });

  it('shows unknown platforms raw', () => {
    expect(formatOs('freebsd')).toBe('freebsd');
  });
});

describe('formatLastSeen', () => {
  const NOW = Date.UTC(2026, 10, 3, 12);

  it('shows "just now" under a minute', () => {
    expect(formatLastSeen(NOW - 30_000, NOW)).toBe('just now');
  });

  it('formats minutes', () => {
    expect(formatLastSeen(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago');
  });

  it('formats hours', () => {
    expect(formatLastSeen(NOW - 60 * 60_000, NOW)).toBe('1 hour ago');
    expect(formatLastSeen(NOW - 3 * 60 * 60_000, NOW)).toBe('3 hours ago');
  });

  it('formats days', () => {
    expect(formatLastSeen(NOW - 2 * 24 * 60 * 60_000, NOW)).toBe('2 days ago');
  });

  it('treats a clock-skewed future time as "just now"', () => {
    expect(formatLastSeen(NOW + 60_000, NOW)).toBe('just now');
  });
});

describe('formatRegisteredDate', () => {
  it('formats as a short month, day, year', () => {
    expect(formatRegisteredDate(Date.UTC(2026, 10, 3, 12))).toBe('Nov 3, 2026');
  });
});

describe('formatUsageSummary', () => {
  it('pluralizes both counts', () => {
    expect(
      formatUsageSummary({ activeWorkspaceCount: 3, activeChatroomCount: 2, capped: false })
    ).toBe('3 workspaces · 2 chatrooms');
  });

  it('uses singular forms for one', () => {
    expect(
      formatUsageSummary({ activeWorkspaceCount: 1, activeChatroomCount: 1, capped: false })
    ).toBe('1 workspace · 1 chatroom');
  });

  it('marks capped counts with a plus and keeps plurals', () => {
    expect(
      formatUsageSummary({ activeWorkspaceCount: 500, activeChatroomCount: 120, capped: true })
    ).toBe('500+ workspaces · 120+ chatrooms');
  });
});

describe('sortMachinesByDisplayName', () => {
  it('sorts by display name case-insensitively', () => {
    const input = [
      machine({ machineId: 'm-bravo', alias: 'bravo' }),
      machine({ machineId: 'm-alpha-host', hostname: 'Alpha' }),
      machine({ machineId: 'm-alpha-alias', alias: 'alpha' }),
    ];

    const sorted = sortMachinesByDisplayName(input);

    expect(sorted.map((m) => m.machineId)).toEqual(['m-alpha-alias', 'm-alpha-host', 'm-bravo']);
  });

  it('breaks display-name ties by registeredAt, then machineId', () => {
    const input = [
      machine({ machineId: 'm-c', alias: 'same', registeredAt: 20 }),
      machine({ machineId: 'm-b', alias: 'same', registeredAt: 10 }),
      machine({ machineId: 'm-a', alias: 'same', registeredAt: 10 }),
    ];

    const sorted = sortMachinesByDisplayName(input);

    expect(sorted.map((m) => m.machineId)).toEqual(['m-a', 'm-b', 'm-c']);
  });

  it('does not mutate the input', () => {
    const input = [
      machine({ machineId: 'm-b', alias: 'bravo' }),
      machine({ machineId: 'm-a', alias: 'alpha' }),
    ];
    const original = [...input];

    sortMachinesByDisplayName(input);

    expect(input).toEqual(original);
  });
});
