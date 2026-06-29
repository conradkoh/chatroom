/**
 * ChatroomScenario — orchestration helper for native prompt / flow tests.
 *
 * Drives the Convex test backend through user messages, task delivery prompts,
 * handoffs, and native injection prompt shaping without a live daemon or LLM.
 */

import type { SessionId } from 'convex-helpers/server/sessions';

import {
  createPlannerBuilderDuoChatroom,
  createTestSession,
  joinParticipant,
  registerMachineWithDaemon,
} from './integration';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { generateHandoffOutput } from '../../prompts/generator';
import { parseSessionAugmentation } from '../../src/domain/handoff/parse-session-augmentation';
import { t } from '../../test.setup';

const DEFAULT_CONVEX_URL = 'http://127.0.0.1:3210';

export type ScenarioTeam = 'duo-planner';

export interface ChatroomScenarioOptions {
  /** Unique session id prefix for test isolation */
  sessionKey?: string;
  team?: ScenarioTeam;
  convexUrl?: string;
}

export interface ConfigureRoleOptions {
  role: string;
  harness?: string;
  machineId?: string;
  workingDir?: string;
}

export interface UserSaysResult {
  messageId: Id<'chatroom_messages'>;
  taskId: Id<'chatroom_tasks'>;
}

export interface HandoffResult {
  mutation: {
    success: boolean;
    supportsNativeIntegration?: boolean;
    newTaskId?: Id<'chatroom_tasks'> | null;
  };
  cliOutput: string;
}

async function createTeamChatroom(
  sessionId: SessionId,
  _team: ScenarioTeam
): Promise<Id<'chatroom_rooms'>> {
  return createPlannerBuilderDuoChatroom(sessionId);
}

/** Shape injected prompt: task delivery body + optional augmentation preamble (mirrors CLI daemon). */
export function buildNativeInjectionPrompt(params: {
  taskDeliveryOutput: string;
  taskContent: string;
}): string {
  const augmentationMode = parseSessionAugmentation(params.taskContent);
  if (augmentationMode === 'compact') {
    return [
      '⚠️ Context was compacted. Run `chatroom get-system-prompt` only if role instructions are missing.',
      '',
      params.taskDeliveryOutput,
    ].join('\n');
  }
  if (augmentationMode === 'new_session') {
    return [
      '⚠️ Starting a new agent session. Run `chatroom get-system-prompt` to reload role instructions if needed.',
      '',
      params.taskDeliveryOutput,
    ].join('\n');
  }
  return params.taskDeliveryOutput;
}

export class ChatroomScenario {
  readonly sessionId: SessionId;
  readonly chatroomId: Id<'chatroom_rooms'>;
  readonly convexUrl: string;
  readonly team: ScenarioTeam;
  private readonly instanceId: string;

  private constructor(
    sessionId: SessionId,
    chatroomId: Id<'chatroom_rooms'>,
    convexUrl: string,
    team: ScenarioTeam,
    instanceId: string
  ) {
    this.sessionId = sessionId;
    this.chatroomId = chatroomId;
    this.convexUrl = convexUrl;
    this.team = team;
    this.instanceId = instanceId;
  }

  static async create(options: ChatroomScenarioOptions = {}): Promise<ChatroomScenario> {
    const instanceId =
      options.sessionKey ?? `scenario-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { sessionId } = await createTestSession(instanceId);
    const team = options.team ?? 'duo-planner';
    const chatroomId = await createTeamChatroom(sessionId, team);
    return new ChatroomScenario(
      sessionId,
      chatroomId,
      options.convexUrl ?? DEFAULT_CONVEX_URL,
      team,
      instanceId
    );
  }

  /** Configure a remote agent harness for a role (enables nativeIntegration in prompts). */
  async configureRole(options: ConfigureRoleOptions): Promise<void> {
    const {
      role,
      harness = 'opencode-sdk',
      machineId = `machine-${this.instanceId}-${role}`,
      workingDir = '/test/workspace',
    } = options;

    await registerMachineWithDaemon(this.sessionId, machineId);
    await joinParticipant(this.sessionId, this.chatroomId, role);

    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId: this.sessionId,
      chatroomId: this.chatroomId,
      role,
      type: 'remote',
      machineId,
      agentHarness: harness,
      model: 'auto',
      workingDir,
    });
  }

  /** User sends a message; returns linked message + auto-created task ids. */
  async userSays(content: string, targetRole = 'planner'): Promise<UserSaysResult> {
    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId: this.sessionId,
      chatroomId: this.chatroomId,
      senderRole: 'user',
      content,
      targetRole,
      type: 'message',
    });

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId: this.sessionId,
      chatroomId: this.chatroomId,
    });

    const task = tasks.find(
      (row: { sourceMessageId?: Id<'chatroom_messages'> }) => row.sourceMessageId === messageId
    );
    if (!task) {
      throw new Error(`No task created for user message ${messageId}`);
    }

    return { messageId, taskId: task._id };
  }

  /** Backend task delivery prompt (what get-next-task / native injector fetches). */
  async deliveryPromptFor(role: string, taskId: Id<'chatroom_tasks'>): Promise<string> {
    const result = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId: this.sessionId,
      chatroomId: this.chatroomId,
      role,
      taskId,
      convexUrl: this.convexUrl,
    });
    return result.fullCliOutput;
  }

  /** Full prompt the daemon injects via resumeTurn (delivery + optional compaction header). */
  async nativeInjectionPromptFor(
    role: string,
    taskId: Id<'chatroom_tasks'>,
    taskContent: string
  ): Promise<string> {
    const delivery = await this.deliveryPromptFor(role, taskId);
    return buildNativeInjectionPrompt({ taskDeliveryOutput: delivery, taskContent });
  }

  /** Claim + read a task so handoff preconditions are met. */
  async startTask(role: string, taskId: Id<'chatroom_tasks'>): Promise<void> {
    await t.mutation(api.tasks.claimTask, {
      sessionId: this.sessionId,
      chatroomId: this.chatroomId,
      role,
      taskId,
    });

    await t.mutation(api.tasks.readTask, {
      sessionId: this.sessionId,
      chatroomId: this.chatroomId,
      role,
      taskId,
    });
  }

  /** Atomic handoff + generated CLI output (what the agent sees after `chatroom handoff`). */
  async handoff(senderRole: string, targetRole: string, content: string): Promise<HandoffResult> {
    const mutation = await t.mutation(api.messages.handoff, {
      sessionId: this.sessionId,
      chatroomId: this.chatroomId,
      senderRole,
      content,
      targetRole,
    });

    const cliOutput = generateHandoffOutput({
      role: senderRole,
      nextRole: targetRole,
      chatroomId: this.chatroomId,
      convexUrl: this.convexUrl,
      supportsNativeIntegration: mutation.supportsNativeIntegration,
    });

    return { mutation, cliOutput };
  }

  /** Find the pending task assigned to a role (after handoff). */
  async pendingTaskFor(role: string): Promise<Id<'chatroom_tasks'>> {
    const tasks = await t.query(api.tasks.listTasks, {
      sessionId: this.sessionId,
      chatroomId: this.chatroomId,
      statusFilter: 'pending',
    });

    const task = tasks.find((row: { assignedTo?: string }) => row.assignedTo === role);
    if (!task) {
      throw new Error(`No pending task for role ${role}`);
    }
    return task._id;
  }

  async taskContent(taskId: Id<'chatroom_tasks'>): Promise<string> {
    const tasks = await t.query(api.tasks.listTasks, {
      sessionId: this.sessionId,
      chatroomId: this.chatroomId,
      statusFilter: 'all',
    });
    const task = tasks.find((row: { _id: Id<'chatroom_tasks'> }) => row._id === taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    return task.content;
  }
}
