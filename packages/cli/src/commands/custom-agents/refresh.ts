/**
 * `chatroom custom-agents refresh` — ask the daemon behind this chatroom's
 * workspace to rescan and push.
 *
 * Unlike enable/disable this does not wait: the mutation only enqueues a machine
 * command, and the daemon's push arrives whenever it arrives. The next `list`
 * shows the result.
 */

import { api, type Id } from '../../api.js';
import { getErrorMessage } from '../../utils/convex-error.js';

/** The slice of the Convex client this command uses; tests inject a fake. */
export interface CustomAgentsRefreshClient {
  mutation: (endpoint: unknown, args: unknown) => Promise<unknown>;
}

export interface RefreshCustomAgentsDeps {
  client: CustomAgentsRefreshClient;
  sessionId: string;
  stdout: (line: string) => void;
  setExitCode: (code: number) => void;
}

export async function refreshCustomAgents(
  chatroomId: string,
  deps: RefreshCustomAgentsDeps
): Promise<void> {
  try {
    await deps.client.mutation(api.customAgents.requestRefresh, {
      sessionId: deps.sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    });
  } catch (error) {
    deps.stdout(getErrorMessage(error));
    deps.setExitCode(1);
    return;
  }
  deps.stdout('refresh requested');
}
