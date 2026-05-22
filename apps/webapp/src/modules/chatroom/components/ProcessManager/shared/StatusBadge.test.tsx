/**
 * StatusBadge unit tests
 *
 * Covers all status labels and the killed reason-aware branching.
 */

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  // Note: CSS text-transform: uppercase is visual only; jsdom renders literal text content
  test.each([
    ['pending', undefined, 'Pending'],
    ['running', undefined, 'Running'],
    ['completed', undefined, 'Completed'],
    ['failed', undefined, 'Failed'],
    ['stopped', undefined, 'Stopped'],
  ] as const)('status=%s → renders label text', (status, _reason, expectedText) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(expectedText)).toBeTruthy();
  });

  describe('killed — reason-aware labels', () => {
    test('no reason → "Killed"', () => {
      render(<StatusBadge status="killed" />);
      expect(screen.getByText('Killed')).toBeTruthy();
    });

    test('unknown reason → "Killed"', () => {
      render(<StatusBadge status="killed" terminationReason="some-unknown-reason" />);
      expect(screen.getByText('Killed')).toBeTruthy();
    });

    test('replaced → "Replaced"', () => {
      render(<StatusBadge status="killed" terminationReason="replaced" />);
      expect(screen.getByText('Replaced')).toBeTruthy();
    });

    test('daemon-restart → "Daemon Restart"', () => {
      render(<StatusBadge status="killed" terminationReason="daemon-restart" />);
      expect(screen.getByText('Daemon Restart')).toBeTruthy();
    });

    test('daemon-shutdown → "Daemon Stopped"', () => {
      render(<StatusBadge status="killed" terminationReason="daemon-shutdown" />);
      expect(screen.getByText('Daemon Stopped')).toBeTruthy();
    });

    test('timeout-24h → "Timed Out"', () => {
      render(<StatusBadge status="killed" terminationReason="timeout-24h" />);
      expect(screen.getByText('Timed Out')).toBeTruthy();
    });

    test('user-clear-stuck → "Cleared"', () => {
      render(<StatusBadge status="killed" terminationReason="user-clear-stuck" />);
      expect(screen.getByText('Cleared')).toBeTruthy();
    });
  });
});
