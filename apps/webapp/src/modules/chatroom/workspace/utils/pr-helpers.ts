/**
 * Shared PR helper utilities for the workspace git panel and modals.
 */

/**
 * Returns a label and CSS class for a PR state badge.
 */
export function prStateBadge(
  state: string,
  isDraft?: boolean,
  mergedAt?: string | null
): { label: string; cls: string } {
  if (isDraft)
    return { label: 'Draft', cls: 'text-chatroom-text-muted border-chatroom-border' };
  if (state === 'MERGED' || mergedAt)
    return {
      label: 'Merged',
      cls: 'text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-700',
    };
  if (state === 'CLOSED')
    return {
      label: 'Closed',
      cls: 'text-red-500 dark:text-red-400 border-red-300 dark:border-red-700',
    };
  return {
    label: 'Open',
    cls: 'text-green-600 dark:text-green-400 border-green-300 dark:border-green-700',
  };
}

/**
 * Formats a date string as relative time (e.g., "2h ago", "3d ago").
 */
export function relativeTime(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
