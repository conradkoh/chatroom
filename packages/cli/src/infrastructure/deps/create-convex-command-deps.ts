import { getSessionId, getOtherSessionUrls } from '../auth/storage.js';
import { getConvexClient, getConvexUrl } from '../convex/client.js';
import type { BackendOps, SessionOps } from './index.js';

export type ConvexCommandDeps = {
  backend: BackendOps;
  session: SessionOps;
};

export async function createConvexCommandDeps(): Promise<ConvexCommandDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: { getSessionId, getConvexUrl, getOtherSessionUrls },
  };
}
