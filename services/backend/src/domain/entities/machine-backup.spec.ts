import { describe, expect, test } from 'vitest';

import {
  canTransition,
  isActiveDownloadStatus,
  isTerminal,
  type BackupStatus,
} from './machine-backup';

const ALL_STATUSES: BackupStatus[] = [
  'requested',
  'preparing',
  'ready',
  'downloading',
  'downloaded',
  'completed',
  'failed',
  'expired',
  'cancelled',
];

/** Literal expectation, not the implementation's own grouping constant. */
const TERMINAL_STATUSES: BackupStatus[] = [
  'downloaded',
  'completed',
  'failed',
  'expired',
  'cancelled',
];

describe('machine backup status groups', () => {
  test('terminal statuses are the five finished states', () => {
    expect(ALL_STATUSES.filter(isTerminal)).toEqual(TERMINAL_STATUSES);
  });

  test('active download statuses are the four non-terminal download states', () => {
    expect(ALL_STATUSES.filter(isActiveDownloadStatus)).toEqual([
      'requested',
      'preparing',
      'ready',
      'downloading',
    ]);
  });
});

describe('canTransition', () => {
  test('allows the download transitions', () => {
    expect(canTransition('download', 'requested', 'preparing')).toBe(true);
    expect(canTransition('download', 'preparing', 'ready')).toBe(true);
    expect(canTransition('download', 'ready', 'downloading')).toBe(true);
    expect(canTransition('download', 'downloading', 'downloaded')).toBe(true);
    expect(canTransition('download', 'ready', 'expired')).toBe(true);
    expect(canTransition('download', 'downloading', 'cancelled')).toBe(true);
    expect(canTransition('download', 'requested', 'cancelled')).toBe(true);
  });

  test('rejects everything from a terminal status', () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(canTransition('download', from, to), `${from} → ${to}`).toBe(false);
      }
    }
  });

  test('inventory can only complete or fail from requested', () => {
    expect(canTransition('inventory', 'requested', 'completed')).toBe(true);
    expect(canTransition('inventory', 'requested', 'failed')).toBe(true);
    expect(canTransition('inventory', 'requested', 'ready')).toBe(false);
    expect(canTransition('inventory', 'preparing', 'completed')).toBe(false);
  });
});
