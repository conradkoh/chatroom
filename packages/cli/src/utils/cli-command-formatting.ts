import { isProductionConvexUrl } from '@workspace/backend/prompts/utils/env.js';

/**
 * Format a copy-pasteable `chatroom auth login` command with env var prefixes
 * for non-production environments.
 *
 * When CHATROOM_WEB_URL is set (e.g. by the local launcher), both vars are
 * included so the user can paste the command into a fresh terminal.
 */
export function formatAuthLoginCommand(
  convexUrl: string,
  env: Record<string, string | undefined> = process.env
): string {
  if (isProductionConvexUrl(convexUrl)) {
    return 'chatroom auth login';
  }

  const webUrl = env.CHATROOM_WEB_URL;
  if (webUrl) {
    return `CHATROOM_WEB_URL=${webUrl} CHATROOM_CONVEX_URL=${convexUrl} chatroom auth login`;
  }

  return `CHATROOM_CONVEX_URL=${convexUrl} chatroom auth login`;
}
