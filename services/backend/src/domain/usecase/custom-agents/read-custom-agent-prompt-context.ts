/**
 * Use Case: Read Custom Agent Prompt Context
 *
 * The only reader of the custom-agent content and handoff-template tables.
 * Prompt composition calls this once per prompt and gets everything it needs to
 * render a user-authored role, or `undefined` when the role is builtin.
 *
 * `undefined` is the contract that keeps builtin prompts byte-identical: it is
 * returned when the chatroom has no enabled custom agents AND the role has no
 * stored definition. A role that is disabled but still in flight keeps its own
 * instructions, so precedence is reused from `resolveChatroomTeam` and the
 * stored-row lookup rather than recomputed here.
 *
 * Read budget (keep exact):
 *   - own role: 1 `chatroom_customAgentContents` row, plus at most 1 `return`
 *     `chatroom_customAgentHandoffTemplates` row (only when the stored flag says
 *     one exists).
 *   - entry point: at most 16 `inbound` template rows, one per enabled delegate
 *     whose stored flag says one exists, and zero content rows.
 *   - fallback self lookup: one workspace resolution plus the bounded agent-row
 *     lookup in `findCustomAgentForRole`; still at most 2 content/template rows.
 */

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import type { ResolvedChatroom } from '../../../../convex/lib/chatroomTeam';
import type {
  CustomAgentPromptContext,
  CustomDelegate,
  CustomRoleInstructions,
} from '../../../../prompts/custom-agents/types';
import { findCustomAgentForRole, type ResolvedCustomAgent } from '../team/resolve-chatroom-team';
import { getPrimaryWorkspaceForChatroom } from '../workspace/get-primary-workspace-for-chatroom';

export interface ReadCustomAgentPromptContextInput {
  chatroom: ResolvedChatroom;
  role: string;
}

type HandoffDirection = 'inbound' | 'return';

/** The fields both `ResolvedCustomAgent` and a stored row give the self renderer. */
interface SelfSource {
  customAgentId: Id<'chatroom_customAgents'>;
  name: string;
  description: string;
  hasReturnHandoffTemplate: boolean;
}

/**
 * Prompt context for one role, or `undefined` when the role is builtin.
 */
export async function readCustomAgentPromptContext(
  ctx: QueryCtx,
  input: ReadCustomAgentPromptContextInput
): Promise<CustomAgentPromptContext | undefined> {
  const agents = input.chatroom.customAgents ?? [];

  const enabled = findEnabledAgent(agents, input.role);
  if (enabled !== undefined) {
    return await buildSelfContext(ctx, input.chatroom, toSelfSource(enabled));
  }
  if (isEntryPoint(input.chatroom, input.role)) {
    return await buildEntryPointContext(ctx, input.chatroom, agents);
  }
  return await buildStoredSelfContext(ctx, input);
}

async function buildStoredSelfContext(
  ctx: QueryCtx,
  input: ReadCustomAgentPromptContextInput
): Promise<CustomAgentPromptContext | undefined> {
  const workspace = await getPrimaryWorkspaceForChatroom(ctx, input.chatroom._id);
  if (workspace === null) return undefined;

  const row = await findCustomAgentForRole(ctx, workspace, input.role);
  if (row === null) return undefined;
  return await buildSelfContext(ctx, input.chatroom, toSelfSourceFromRow(row));
}

/** The role's own instructions: one content row plus an optional return template. */
async function buildSelfContext(
  ctx: QueryCtx,
  chatroom: ResolvedChatroom,
  source: SelfSource
): Promise<CustomAgentPromptContext> {
  const [systemPrompt, returnHandoffTemplate] = await Promise.all([
    readContentBody(ctx, source.customAgentId),
    source.hasReturnHandoffTemplate
      ? readTemplateBody(ctx, source.customAgentId, 'return')
      : Promise.resolve(null),
  ]);

  const self: CustomRoleInstructions = {
    name: source.name,
    description: source.description,
    systemPrompt: systemPrompt ?? '',
    returnHandoffTemplate,
  };
  return { entryPoint: resolveEntryPoint(chatroom), self, delegates: [] };
}

/** The entry point's delegates: at most one inbound template row each, no content rows. */
async function buildEntryPointContext(
  ctx: QueryCtx,
  chatroom: ResolvedChatroom,
  agents: readonly ResolvedCustomAgent[]
): Promise<CustomAgentPromptContext> {
  const delegates = await Promise.all(agents.map((agent) => toDelegate(ctx, agent)));
  return { entryPoint: resolveEntryPoint(chatroom), delegates };
}

async function toDelegate(ctx: QueryCtx, agent: ResolvedCustomAgent): Promise<CustomDelegate> {
  const inboundHandoffTemplate = agent.hasInboundHandoffTemplate
    ? await readTemplateBody(ctx, agent.customAgentId, 'inbound')
    : null;
  return { name: agent.name, description: agent.description, inboundHandoffTemplate };
}

function findEnabledAgent(
  agents: readonly ResolvedCustomAgent[],
  role: string
): ResolvedCustomAgent | undefined {
  const normalized = role.toLowerCase();
  return agents.find((agent) => agent.name.toLowerCase() === normalized);
}

function isEntryPoint(chatroom: ResolvedChatroom, role: string): boolean {
  return chatroom.teamEntryPoint === role;
}

/**
 * A custom agent only reaches prompt composition through a resolved team, so the
 * entry point is always set in practice; the empty fallback keeps the type total
 * without inventing a role name.
 */
function resolveEntryPoint(chatroom: ResolvedChatroom): string {
  return chatroom.teamEntryPoint ?? '';
}

function toSelfSource(agent: ResolvedCustomAgent): SelfSource {
  return {
    customAgentId: agent.customAgentId,
    name: agent.name,
    description: agent.description,
    hasReturnHandoffTemplate: agent.hasReturnHandoffTemplate,
  };
}

function toSelfSourceFromRow(row: Doc<'chatroom_customAgents'>): SelfSource {
  return {
    customAgentId: row._id,
    name: row.name,
    description: row.description,
    hasReturnHandoffTemplate: row.hasReturnHandoffTemplate,
  };
}

async function readContentBody(
  ctx: QueryCtx,
  customAgentId: Id<'chatroom_customAgents'>
): Promise<string | null> {
  const row = await ctx.db
    .query('chatroom_customAgentContents')
    .withIndex('by_customAgent', (q) => q.eq('customAgentId', customAgentId))
    .first();
  return row?.systemPrompt ?? null;
}

async function readTemplateBody(
  ctx: QueryCtx,
  customAgentId: Id<'chatroom_customAgents'>,
  direction: HandoffDirection
): Promise<string | null> {
  const row = await ctx.db
    .query('chatroom_customAgentHandoffTemplates')
    .withIndex('by_customAgent_direction', (q) =>
      q.eq('customAgentId', customAgentId).eq('direction', direction)
    )
    .first();
  return row?.body ?? null;
}
