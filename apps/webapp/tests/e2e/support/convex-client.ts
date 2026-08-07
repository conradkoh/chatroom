import { api } from '@workspace/backend/convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { getConvexUrl } from './env';

export async function promoteSessionToSystemAdmin(sessionId: SessionId): Promise<void> {
  const client = new ConvexHttpClient(getConvexUrl());
  await client.mutation(api.e2e.promoteSessionToSystemAdmin, { sessionId });
}
