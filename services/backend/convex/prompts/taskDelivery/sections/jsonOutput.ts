/**
 * JSON OUTPUT builder - constructs the structured JSON data.
 * This is not a PromptSection as it doesn't render to human-readable text,
 * but it builds the JSON payload for programmatic parsing.
 */

import type { TaskDeliveryContext, TaskDeliveryJsonOutput, AttachedTask } from '../types';

/**
 * Builds the JSON output structure for the task delivery prompt.
 */
export function buildJsonOutput(ctx: TaskDeliveryContext): TaskDeliveryJsonOutput {
  const senderRole = ctx.message?.senderRole || ctx.task.createdBy;
  const displayContent = ctx.message?.content || ctx.task.content;
  const messageType = ctx.message?.type || 'message';

  // Determine if classification is needed
  const needsClassification =
    ctx.rolePrompt.currentClassification === null && senderRole.toLowerCase() === 'user';

  // Build classification commands
  const classificationCommands = {
    question: `chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=question`,
    new_feature: `chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=new_feature --title="<title>" --description="<description>" --tech-specs="<specifications>"`,
    follow_up: `chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=follow_up`,
  };

  // Build context commands (always include for builder role)
  const contextCommands =
    ctx.role.toLowerCase() === 'builder'
      ? [
          `chatroom feature list ${ctx.chatroomId} --limit=5`,
          `chatroom backlog list ${ctx.chatroomId} --role=${ctx.role} --status=active --full`,
          `chatroom backlog add ${ctx.chatroomId} --role=${ctx.role} --content="<description>"`,
          `chatroom backlog complete ${ctx.chatroomId} --role=${ctx.role} --taskId=<id>`,
        ]
      : undefined;

  // Build origin message with attached tasks
  const originMessage = ctx.contextWindow.originMessage
    ? {
        id: ctx.contextWindow.originMessage._id,
        senderRole: ctx.contextWindow.originMessage.senderRole,
        content: ctx.contextWindow.originMessage.content,
        classification: ctx.contextWindow.originMessage.classification,
        ...(ctx.contextWindow.originMessage.attachedTaskIds &&
          ctx.contextWindow.originMessage.attachedTaskIds.length > 0 && {
            attachedTaskIds: ctx.contextWindow.originMessage.attachedTaskIds,
            attachedTasks: ctx.contextWindow.originMessage.attachedTasks,
          }),
      }
    : null;

  // Build all messages with attached tasks
  const allMessages = ctx.contextWindow.contextMessages.map((m) => ({
    id: m._id,
    senderRole: m.senderRole,
    content: m.content,
    type: m.type,
    targetRole: m.targetRole,
    classification: m.classification,
    ...(m.attachedTaskIds &&
      m.attachedTaskIds.length > 0 && {
        attachedTaskIds: m.attachedTaskIds,
        attachedTasks: (m as { attachedTasks?: AttachedTask[] }).attachedTasks,
      }),
  }));

  return {
    message: {
      id: ctx.message?._id || ctx.task._id,
      senderRole: senderRole,
      content: displayContent,
      type: messageType,
    },
    task: {
      id: ctx.task._id,
      status: ctx.task.status,
      createdBy: ctx.task.createdBy,
      queuePosition: ctx.task.queuePosition,
    },
    chatroom: {
      id: ctx.chatroomId,
      participants: ctx.participants.map((p) => ({
        role: p.role,
        status: p.status,
        isYou: p.role.toLowerCase() === ctx.role.toLowerCase(),
        availableForHandoff:
          p.status === 'waiting' && p.role.toLowerCase() !== ctx.role.toLowerCase(),
      })),
    },
    context: {
      originMessage,
      allMessages,
      currentClassification: ctx.contextWindow.classification,
    },
    instructions: {
      taskStartedCommand: needsClassification
        ? `chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=<question|new_feature|follow_up>`
        : null,
      taskCompleteCommand: `chatroom handoff ${ctx.chatroomId} --role=${ctx.role} --message="<summary>" --next-role=<target>`,
      availableHandoffRoles: ctx.rolePrompt.availableHandoffRoles,
      terminationRole: 'user',
      classification: ctx.rolePrompt.currentClassification,
      handoffRestriction: ctx.rolePrompt.restrictionReason,
      classificationCommands,
      contextCommands,
    },
  };
}
