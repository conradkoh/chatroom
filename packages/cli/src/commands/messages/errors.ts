/**
 * Shared support for the page-based `messages` commands.
 *
 * `MessagesError` is the session/chatroom/query failure union; the two helpers
 * below keep `pages.ts` and `download.ts` from duplicating their entry-point
 * wiring and their common error formatting.
 */

import type { PageSelectionError } from './page-selection.js';
import { formatPageSelectionError } from './page-selection.js';
import type { CommandServicesDeps } from '../../infrastructure/services/index.js';
import { commandServicesLayerFromDeps } from '../../infrastructure/services/index.js';

export type MessagesError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'QueryFailed'; readonly cause: Error };

/**
 * Builds the command service layer from caller-supplied deps, or from the
 * authenticated Convex client when none are supplied.
 */
export async function messagesCommandLayer(deps?: CommandServicesDeps) {
  if (deps) return commandServicesLayerFromDeps(deps);

  const { getSessionId, getOtherSessionUrls } =
    await import('../../infrastructure/auth/storage.js');
  const { getConvexClient, getConvexUrl } = await import('../../infrastructure/convex/client.js');
  const client = await getConvexClient();
  return commandServicesLayerFromDeps({
    backend: {
      mutation: (
        ep: Parameters<typeof client.mutation>[0],
        args: Parameters<typeof client.mutation>[1]
      ) => client.mutation(ep, args),
      query: (ep: Parameters<typeof client.query>[0], args: Parameters<typeof client.query>[1]) =>
        client.query(ep, args),
    },
    session: { getSessionId, getConvexUrl, getOtherSessionUrls },
  });
}

/**
 * Formats the errors shared by `pages` and `download`, or returns null for
 * command-specific errors (output directory, file writes).
 */
// fallow-ignore-next-line complexity
export function messagesErrorLine(err: unknown, chatroomId: string, role: string): string | null {
  const tagged = err as { _tag?: string };
  switch (tagged._tag) {
    case 'NotAuthenticated':
      return '❌ Not authenticated';
    case 'InvalidChatroomId':
      return '❌ Invalid chatroom ID';
    case 'PageNotFound':
    case 'InvalidPage':
    case 'InvalidPageSelection':
    case 'QueryFailed':
      return formatPageSelectionError(err as PageSelectionError, chatroomId, role);
    default:
      return null;
  }
}
