/**
 * Convex functions for custom agents.
 *
 * File-authored definitions reach Convex through `syncDefinitions`, which the
 * daemon calls as the machine owner. Resolution and settings reads live beside
 * this module in the custom-agent use cases.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from './_generated/server';
import { requireSession } from './auth/session';
import { customAgentIssueValidator, customAgentScopeValidator } from './schema';
import { checkAccess } from '../modules/auth/accessCheck';
import { syncCustomAgentDefinitions } from '../src/domain/usecase/custom-agents/sync-custom-agent-definitions';

const customAgentDefinitionValidator = v.object({
  name: v.string(),
  description: v.string(),
  systemPrompt: v.string(),
  inboundHandoffTemplate: v.optional(v.string()),
  returnHandoffTemplate: v.optional(v.string()),
  contentHash: v.string(),
});

/**
 * Replaces the pushed definition snapshot for one machine source.
 *
 * The daemon is the only writer. An unchanged push is a no-op, and invalid
 * definitions are returned as rejections instead of failing the whole sync.
 */
export const syncDefinitions = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    scope: customAgentScopeValidator,
    workingDir: v.optional(v.string()),
    contentHash: v.string(),
    agents: v.array(customAgentDefinitionValidator),
    issues: v.array(customAgentIssueValidator),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.sessionId);
    const ownerCheck = await checkAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'owner',
    });
    if (!ownerCheck.ok) {
      throw new ConvexError({
        code: 'NOT_AUTHORIZED_MACHINE',
        message: 'Not authorized for this machine',
      });
    }

    return syncCustomAgentDefinitions(ctx, args);
  },
});
