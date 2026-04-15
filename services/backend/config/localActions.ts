/**
 * Canonical definition of supported local action types.
 *
 * These values must stay in sync with the Convex schema validator in
 * `services/backend/convex/schema.ts` (the `daemon.localAction` event type).
 *
 * Both the CLI execution layer and the webapp hook import this type
 * to avoid independent definitions drifting apart.
 */
export type LocalActionType =
  | 'open-vscode'
  | 'open-finder'
  | 'open-github-desktop'
  | 'git-discard-file'
  | 'git-discard-all'
  | 'git-pull';
