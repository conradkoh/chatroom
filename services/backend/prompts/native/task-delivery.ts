/**
 * Slim task delivery output for native-integration harnesses.
 *
 * Focus: task content + role guidance + task intake + next steps + handoff templates + handoff commands.
 * No listen-loop, injection, or session-lifecycle framing — the system
 * delivers work; the agent completes it and hands off.
 */

import { renderDeliveryAttachmentsBlock } from '../attachments/render-delivery-attachments.js';
import { buildSelectorContext, getRoleGuidanceFromContext } from '../selector-context';
import {
  getNativeTaskStartedPrompt,
  getNativeTaskStartedPromptForHandoffRecipient,
} from './task-started-content';
import {
  appendTaskDeliveryHandoffTargets,
  appendTaskDeliveryHandoffTemplates,
  appendTaskDeliveryNextSteps,
  type TaskDeliveryParams,
} from '../task-delivery/core.js';
import { duoTeamConfig } from '../teams/duo/config';
import { soloTeamConfig } from '../teams/solo/config';

export type NativeTaskDeliveryParams = TaskDeliveryParams;

function convexUrlFromCliEnvPrefix(cliEnvPrefix: string): string {
  const match = cliEnvPrefix.match(/CHATROOM_CONVEX_URL=(\S+)/);
  return match?.[1] ?? '';
}

function resolveTeamFromId(teamId?: string): {
  teamId?: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint: string;
} {
  if (teamId === 'solo') {
    return {
      teamId: 'solo',
      teamName: soloTeamConfig.name,
      teamRoles: soloTeamConfig.roles,
      teamEntryPoint: soloTeamConfig.entryPoint,
    };
  }
  if (teamId === 'duo') {
    return {
      teamId: 'duo',
      teamName: duoTeamConfig.name,
      teamRoles: duoTeamConfig.roles,
      teamEntryPoint: duoTeamConfig.entryPoint,
    };
  }
  return { teamId, teamName: teamId ?? '', teamRoles: [], teamEntryPoint: '' };
}

function appendNativeRoleContext(
  lines: string[],
  params: Pick<
    NativeTaskDeliveryParams,
    'chatroomId' | 'role' | 'cliEnvPrefix' | 'teamId' | 'isEntryPoint'
  >
): void {
  const { chatroomId, role, cliEnvPrefix, teamId, isEntryPoint } = params;
  const team = resolveTeamFromId(teamId);
  const convexUrl = convexUrlFromCliEnvPrefix(cliEnvPrefix);

  const ctx = buildSelectorContext({
    role,
    teamRoles: team.teamRoles,
    teamId: team.teamId,
    teamName: team.teamName,
    teamEntryPoint: team.teamEntryPoint,
    convexUrl,
    chatroomId,
    nativeIntegration: true,
  });

  lines.push('');
  lines.push('<role-guidance>');
  lines.push(getRoleGuidanceFromContext(ctx));
  lines.push('</role-guidance>');

  const taskIntakeContent = isEntryPoint
    ? getNativeTaskStartedPrompt({ chatroomId, role, cliEnvPrefix })
    : getNativeTaskStartedPromptForHandoffRecipient();

  lines.push('');
  lines.push('<task-intake>');
  lines.push(taskIntakeContent);
  lines.push('</task-intake>');
}

/** Task body, role context, next steps, templates, and handoff commands. */
export function generateNativeTaskDeliveryOutput(params: NativeTaskDeliveryParams): string {
  const {
    chatroomId,
    role,
    cliEnvPrefix,
    teamId,
    task,
    message,
    availableHandoffTargets,
    attachedMessages = [],
    isEntryPoint,
    sourceAttachments,
  } = params;

  const lines: string[] = [`<task>`, `Task ID: ${task._id}`];
  if (message) lines.push(`From: ${message.senderRole}`);
  lines.push('', task.content);
  lines.push(
    ...renderDeliveryAttachmentsBlock(
      { attachedSnippets: sourceAttachments?.attachedSnippets },
      { chatroomId, role, mode: 'native' }
    )
  );

  for (const attached of attachedMessages) {
    lines.push('', '<attached>', `From: ${attached.senderRole}`, attached.content, '</attached>');
  }

  lines.push('</task>');
  appendNativeRoleContext(lines, { chatroomId, role, cliEnvPrefix, teamId, isEntryPoint });
  appendTaskDeliveryNextSteps(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    message,
    availableHandoffTargets,
    task,
    isEntryPoint,
  });
  appendTaskDeliveryHandoffTemplates(lines, { teamId, role });
  appendTaskDeliveryHandoffTargets(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    availableHandoffTargets,
  });

  return lines.join('\n').trim();
}
