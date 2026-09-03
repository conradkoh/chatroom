import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { bumpMachineFileTreeReleaseHead } from './bump-machine-file-tree-release-head';
import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';

describe('bumpMachineFileTreeReleaseHead', () => {
  test('starts at revision one and increments an existing machine head', async () => {
    const sessionId = 'file-tree-release-head-bump' as SessionId;
    await t.mutation(api.auth.loginAnon, { sessionId });

    const machineId = 'machine-file-tree-release-head-bump';
    const revisions = await t.run(async (ctx) => [
      await bumpMachineFileTreeReleaseHead(ctx, machineId),
      await bumpMachineFileTreeReleaseHead(ctx, machineId),
    ]);

    expect(revisions).toEqual([1, 2]);

    const head = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineFileTreeReleaseHeads')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first()
    );
    expect(head).toMatchObject({ machineId, revision: 2 });
  });
});
