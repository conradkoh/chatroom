/**
 * Shared task-delivery prompt assembly.
 *
 * Single source of truth for the standard delivery prompt consumed by every
 * delivery paths. Path-specific behaviour lives in the callers (auth and
 * harness integration); the prompt body is composed here so ephemeral agents
 * receive exactly the same delivery prompt as permanent agents.
 */

import { legacyConversationMode } from '@workspace/shared/domain/conversation-mode';
import { normalizeTaskEnvelope } from '@workspace/shared/domain/task-envelope';

import { withActiveTeamStructure } from './chatroomTeam';
import { buildAvailableHandoffRoles } from './handoffRoles';
import { generateFullCliOutput } from '../../prompts/cli/get-next-task/fullOutput';
import { getConfig } from '../../prompts/config/index';
import { getCliEnvPrefix } from '../../prompts/utils/index';
import {
  assemblePrimaryDeliveryAttachments,
  resolvePrimaryDeliveryAssemblyInput,
} from '../../src/domain/entities/assemble-primary-delivery-attachments';
import { isNativeHarness } from '../../src/domain/entities/harness/types';
import type { PrimaryDeliveryAttachments } from '../../src/domain/entities/message-attachments';
import { isActiveParticipant } from '../../src/domain/entities/participant';
import { getActiveStandingInstructions } from '../../src/domain/entities/standing-instructions';
import { getTeamEntryPoint } from '../../src/domain/entities/team';
import { getLastSentLaunchRequestForRole } from '../../src/domain/usecase/agent/get-last-sent-launch-request';
import { getTeamRolesFromChatroom } from '../../src/domain/usecase/chatroom/get-team-roles';
import type { TaskStatus } from '../../src/domain/usecase/task/transition-task';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

const config = getConfig();

// =============================================================================
// Source-message attachments
// =============================================================================

interface SourceMessageAttachmentFields {
  attachedSnippets?:
    { reference: string; fileSource: string; selectedContent: string }[] | undefined;
  attachedTaskIds?: Id<'chatroom_tasks'>[] | undefined;
  attachedBacklogItemIds?: Id<'chatroom_backlog'>[] | undefined;
  attachedMessageIds?: Id<'chatroom_messages'>[] | undefined;
}

/**
 * Fetch one attachment kind by id and project it into its assembly-map entry.
 * Missing docs are skipped — a deleted attachment never blocks delivery.
 */
async function collectAttachmentEntries<TId extends string, TDoc, TEntry>(
  ids: readonly TId[] | undefined,
  getDoc: (id: TId) => Promise<TDoc | null>,
  toEntry: (doc: TDoc) => TEntry
): Promise<Map<string, TEntry>> {
  const entries = new Map<string, TEntry>();
  for (const id of ids ?? []) {
    const doc = await getDoc(id);
    if (doc) {
      entries.set(id, toEntry(doc));
    }
  }
  return entries;
}

/**
 * Resolves primary-delivery attachments for task delivery from a task source
 * message's attachment IDs only (on-demand DB lookups). Returns undefined when
 * the message is absent or carries no primary-delivery attachments.
 */
async function resolveSourceAttachmentsForDelivery(
  ctx: QueryCtx,
  message: SourceMessageAttachmentFields | null
): Promise<PrimaryDeliveryAttachments | undefined> {
  if (!message) return undefined;

  const [attachedTasksMap, attachedBacklogItemsMap, attachedMessagesMap] = await Promise.all([
    collectAttachmentEntries(
      message.attachedTaskIds,
      (id) => ctx.db.get('chatroom_tasks', id),
      (t) => ({
        id: t._id,
        content: t.content,
        status: t.status as TaskStatus,
        createdBy: t.createdBy,
      })
    ),
    collectAttachmentEntries(
      message.attachedBacklogItemIds,
      (id) => ctx.db.get('chatroom_backlog', id),
      (item) => ({
        id: item._id,
        content: item.content,
        status: item.status,
      })
    ),
    collectAttachmentEntries(
      message.attachedMessageIds,
      (id) => ctx.db.get('chatroom_messages', id),
      (m) => ({
        id: m._id,
        content: m.content,
        senderRole: m.senderRole,
      })
    ),
  ]);

  // resolvePrimaryDeliveryAssemblyInput re-derives per-kind emptiness itself.
  const assemblyInput = resolvePrimaryDeliveryAssemblyInput(
    message,
    attachedBacklogItemsMap,
    attachedTasksMap,
    attachedMessagesMap
  );
  return assemblePrimaryDeliveryAttachments(assemblyInput);
}

// =============================================================================
// Delivery prompt composition
// =============================================================================

export interface BuildTaskDeliveryPromptArgs {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  taskId: Id<'chatroom_tasks'>;
  /** Explicit source message (CLI get-next-task); defaults to task.sourceMessageId. */
  messageId?: Id<'chatroom_messages'> | Id<'chatroom_messageQueue'> | undefined;
  convexUrl?: string | undefined;
  /**
   * Entry-point override for delivery paths whose caller owns the entry point.
   * Defaults to the chatroom's configured team entry point.
   */
  entryPointRole?: string | undefined;
}

interface DeliveryMessage extends SourceMessageAttachmentFields {
  _id: Id<'chatroom_messages'> | Id<'chatroom_messageQueue'>;
  senderRole: string;
  content: string;
}

interface DeliveryModePolicy {
  conversationMode: ReturnType<typeof legacyConversationMode>;
}

async function getChatroomMessageOrNull(
  ctx: QueryCtx,
  messageId: Id<'chatroom_messages'>
): Promise<DeliveryMessage | null> {
  const message = await ctx.db.get('chatroom_messages', messageId).catch(() => null);
  return message ?? null;
}

async function getQueuedMessageOrNull(
  ctx: QueryCtx,
  messageId: Id<'chatroom_messageQueue'>
): Promise<DeliveryMessage | null> {
  const message = await ctx.db.get('chatroom_messageQueue', messageId).catch(() => null);
  return message ?? null;
}

/**
 * Explicit messageId (CLI get-next-task) wins; otherwise the task's source
 * message is used (native injection / job delivery). A queue id is only ever
 * reachable through an explicit id, never through the task row.
 */
async function resolveDeliverySourceMessage(
  ctx: QueryCtx,
  task: Doc<'chatroom_tasks'>,
  messageId: BuildTaskDeliveryPromptArgs['messageId']
): Promise<DeliveryMessage | null> {
  if (messageId) {
    const regularMessage = await getChatroomMessageOrNull(
      ctx,
      messageId as Id<'chatroom_messages'>
    );
    if (regularMessage) return regularMessage;
    return await getQueuedMessageOrNull(ctx, messageId as Id<'chatroom_messageQueue'>);
  }

  if (!task.sourceMessageId) return null;
  return await getChatroomMessageOrNull(ctx, task.sourceMessageId);
}

/**
 * Effective conversation mode: the explicit task envelope is the
 * authoritative per-message policy. Legacy rows without an envelope use
 * their persisted scalar snapshot and default to code mode.
 */
function resolveDeliveryModePolicy(task: Doc<'chatroom_tasks'>): DeliveryModePolicy {
  if (task.taskEnvelope === undefined) {
    return {
      conversationMode: legacyConversationMode(task.plannerEnhancerEnabled),
    };
  }
  const envelope = normalizeTaskEnvelope(task);
  return {
    conversationMode: envelope.conversationMode,
  };
}

/**
 * Handoff targets for the delivery prompt. Configured team roles are
 * authoritative structural capability; active participants remain a legacy
 * fallback for empty-membership rooms.
 */
async function resolveAvailableHandoffRoles(
  ctx: QueryCtx,
  chatroom: Doc<'chatroom_rooms'>,
  role: string
): Promise<string[]> {
  const participants = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroom._id))
    .collect();

  const waitingParticipantRoles = participants
    .filter((p) => p.role.toLowerCase() !== role.toLowerCase() && isActiveParticipant(p))
    .map((p) => p.role);

  const { teamRoles } = getTeamRolesFromChatroom(chatroom);
  return buildAvailableHandoffRoles({
    teamRoles,
    currentRole: role,
    fallbackParticipantRoles: waitingParticipantRoles,
  });
}

/** Native integration is decided by the role's most recent agent launch. */
async function isNativeIntegrationDelivery(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<boolean> {
  const launchRequest = await getLastSentLaunchRequestForRole(ctx, { chatroomId, role });
  return isNativeHarness(launchRequest?.agentHarness);
}

/** Entry-point status for context management. */
function resolveEntryPointStatus(
  chatroom: Doc<'chatroom_rooms'>,
  role: string,
  entryPointRoleOverride?: string | undefined
): { entryPointRole?: string; isEntryPoint: boolean } {
  const entryPointRole = entryPointRoleOverride ?? getTeamEntryPoint(chatroom);
  if (!entryPointRole) {
    // No entry point configured: deliver with entry-point context.
    return { isEntryPoint: true };
  }
  return {
    entryPointRole,
    isEntryPoint: role.toLowerCase() === entryPointRole.toLowerCase(),
  };
}

function toDeliveryMessageRef(message: DeliveryMessage | null) {
  if (!message) return null;
  return { _id: message._id, senderRole: message.senderRole, content: message.content };
}

function resolveDeliveryTeamId(chatroom: Doc<'chatroom_rooms'>) {
  return chatroom.teamId ?? 'duo';
}

/**
 * Compose the standard task delivery prompt for one task. Callers own
 * authentication; this resolves the chatroom, task, source message,
 * participants, and task-envelope policy, then delegates to the shared
 * `generateFullCliOutput` pipeline.
 */
export async function buildTaskDeliveryPrompt(
  ctx: QueryCtx,
  args: BuildTaskDeliveryPromptArgs
): Promise<{ fullCliOutput: string }> {
  const task = await ctx.db.get('chatroom_tasks', args.taskId);
  if (!task) {
    throw new Error(`Task ${args.taskId} not found`);
  }

  const message = await resolveDeliverySourceMessage(ctx, task, args.messageId);

  const rawChatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!rawChatroom) {
    throw new Error(`Chatroom ${args.chatroomId} not found`);
  }
  const chatroom = await withActiveTeamStructure(ctx, rawChatroom);

  const modePolicy = resolveDeliveryModePolicy(task);
  const availableHandoffTargets = await resolveAvailableHandoffRoles(ctx, chatroom, args.role);
  const sourceAttachments = await resolveSourceAttachmentsForDelivery(ctx, message);
  const { isEntryPoint } = resolveEntryPointStatus(chatroom, args.role, args.entryPointRole);
  const nativeIntegration = await isNativeIntegrationDelivery(ctx, args.chatroomId, args.role);
  const cliEnvPrefix = getCliEnvPrefix(config.getConvexURLWithFallback(args.convexUrl));

  // Generate the complete CLI output (backend-generated, CLI just prints it)
  const fullCliOutput = generateFullCliOutput({
    chatroomId: args.chatroomId,
    role: args.role,
    cliEnvPrefix,
    teamId: resolveDeliveryTeamId(chatroom),
    task: { _id: task._id, content: task.content },
    message: toDeliveryMessageRef(message),
    isEntryPoint,
    availableHandoffTargets,
    nativeIntegration,
    sourceAttachments,
    standingInstructions: getActiveStandingInstructions(chatroom),
    conversationMode: modePolicy.conversationMode,
  });
  return { fullCliOutput };
}
