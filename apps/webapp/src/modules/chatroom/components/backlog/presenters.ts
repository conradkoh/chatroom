import type { BacklogItem } from './types';

/**
 * Returns label and CSS classes for a backlog item status badge.
 */
export function getBacklogStatusBadge(status: BacklogItem['status']): {
  label: string;
  classes: string;
} {
  switch (status) {
    case 'backlog':
      return {
        label: 'Backlog',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
    case 'pending_user_review':
      return {
        label: 'Pending Review',
        classes: 'bg-violet-500/15 text-violet-500 dark:bg-violet-400/15 dark:text-violet-400',
      };
    case 'closed':
      return {
        label: 'Closed',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
    default:
      return {
        label: status,
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
  }
}

/**
 * Returns label and CSS classes for a scoring badge (complexity or value).
 * - Complexity: C:L / C:M / C:H
 * - Value: V:L / V:M / V:H
 */
export function getScoringBadge(
  type: 'complexity' | 'value',
  level: 'low' | 'medium' | 'high'
): { label: string; classes: string } {
  const colors = {
    low: 'bg-green-500/15 text-green-600 dark:text-green-400',
    medium: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
    high: 'bg-red-500/15 text-red-600 dark:text-red-400',
  };
  const labels = {
    complexity: { low: 'C:L', medium: 'C:M', high: 'C:H' },
    value: { low: 'V:L', medium: 'V:M', high: 'V:H' },
  };
  return {
    label: labels[type][level],
    classes: colors[level],
  };
}
