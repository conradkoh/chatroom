/**
 * Human-readable copy for custom-agent issues and mutations.
 *
 * Every entry is keyed by `CustomAgentIssueReason`, so adding a reason to the
 * shared vocabulary is a compile error here rather than a silent blank row.
 * Limits are interpolated from `CUSTOM_AGENT_LIMITS`; never hard-code them.
 */

import {
  CUSTOM_AGENT_LIMITS,
  type CustomAgentIssue,
  type CustomAgentIssueReason,
} from '@workspace/shared/domain/custom-agent';
import { ConvexError } from 'convex/values';

import { getErrorMessage } from '../../../../lib/convexError';

export interface CustomAgentIssueCopy {
  title: string;
  action: string;
  tone: 'warning' | 'info';
}

const SYSTEM_PROMPT_KB = CUSTOM_AGENT_LIMITS.systemPromptMaxBytes / 1024;
const HANDOFF_TEMPLATE_KB = CUSTOM_AGENT_LIMITS.handoffTemplateMaxBytes / 1024;

export const CUSTOM_AGENT_ISSUE_COPY: Record<CustomAgentIssueReason, CustomAgentIssueCopy> = {
  'missing-frontmatter': {
    tone: 'warning',
    title: 'No frontmatter block',
    action: 'Start AGENT.md with a `---` block that sets name and description.',
  },
  'invalid-frontmatter': {
    tone: 'warning',
    title: 'Frontmatter could not be read',
    action: 'Fix the YAML between the `---` lines. Use plain `key: value` lines.',
  },
  'invalid-name': {
    tone: 'warning',
    title: 'Name is not allowed',
    action: `Use lowercase letters, digits, and single hyphens, up to ${CUSTOM_AGENT_LIMITS.nameMaxLength} characters.`,
  },
  'name-mismatch': {
    tone: 'warning',
    title: 'Name does not match the folder',
    action: 'Make the folder name and the `name:` field the same.',
  },
  'reserved-name': {
    tone: 'warning',
    title: 'Name is reserved',
    action: 'Built-in roles, `user`, and retired roles cannot be reused. Pick another name.',
  },
  'invalid-description': {
    tone: 'warning',
    title: 'Description is empty',
    action: 'Add a one-line `description:` field.',
  },
  'forbidden-field': {
    tone: 'warning',
    title: 'Model or harness set in the file',
    action: 'Remove this field. Choose models in the Agents tab instead.',
  },
  'unknown-field': {
    tone: 'warning',
    title: 'Unknown frontmatter field',
    action: 'Only `name` and `description` are allowed. Remove this field.',
  },
  'too-large': {
    tone: 'warning',
    title: 'File is too large',
    action: `Keep AGENT.md under ${SYSTEM_PROMPT_KB} KB and each handoff template under ${HANDOFF_TEMPLATE_KB} KB.`,
  },
  'reserved-delimiter': {
    tone: 'warning',
    title: 'Contains a reserved line',
    action: 'Remove any line that is exactly `CHATROOM_HANDOFF_END` or `CHATROOM_NOTIFY_END`.',
  },
  unreadable: {
    tone: 'warning',
    title: 'Could not be read',
    action:
      'Check that it exists, is a real folder or file (not a symlink), and that you can read it.',
  },
  'root-truncated': {
    tone: 'warning',
    title: 'Some agents were skipped',
    action: `Keep at most ${CUSTOM_AGENT_LIMITS.agentsPerSource} agents in this folder. Remove folders you no longer use.`,
  },
  gitignored: {
    tone: 'warning',
    title: 'Git ignores this folder',
    action:
      'Agents here still load on this machine, but teammates will not get them. Update .gitignore:',
  },
  shadowed: {
    tone: 'info',
    title: 'Replaced by the workspace agent with the same name',
    action: 'The workspace copy is used. Rename or delete this copy to keep both.',
  },
  'over-limit': {
    tone: 'warning',
    title: `Over the ${CUSTOM_AGENT_LIMITS.agentsPerChatroom}-agent limit`,
    action: 'This agent was not added to the team. Turn off another custom agent to make room.',
  },
};

export const CUSTOM_AGENT_TOGGLE_TIMEOUT_MESSAGE =
  'The machine did not respond. Is the daemon running? The change still applies if the daemon reconnects within a few minutes.';

/**
 * Shown on a toggle whose enable the per-chatroom cap rejected. The roster drops
 * such an agent entirely, so this copy is the only feedback the user gets.
 */
export const CUSTOM_AGENT_OVER_LIMIT_MESSAGE = `This agent was not turned on: the chatroom can run ${CUSTOM_AGENT_LIMITS.agentsPerChatroom} custom agents at once. Turn off another one to make room.`;

export const CUSTOM_AGENTS_GITIGNORE_SNIPPET = '.chatroom/*\n!.chatroom/agents/';

export const CUSTOM_AGENT_EXAMPLE_FILE =
  '---\nname: release-reviewer\ndescription: Reviews release notes before publishing.\n---\n\nYou are the release reviewer. Check release notes against the changes and return corrections to the planner.';

const TOO_LARGE_DETAILS: Record<string, string> = {
  systemPrompt: 'AGENT.md body',
  inboundHandoffTemplate: 'inbound-handoff.md',
  returnHandoffTemplate: 'return-handoff.md',
};

const UNREADABLE_DETAILS: Record<string, string> = {
  symlink: 'symlinks are not followed',
  'not-directory': 'not a folder',
  'root-outside-workspace': 'folder points outside the workspace',
  EACCES: 'permission denied',
  EPERM: 'permission denied',
};

/** Per-reason detail formatters. Reasons without one fall back to the raw detail. */
const DETAIL_FORMATTERS: Partial<Record<CustomAgentIssueReason, (detail: string) => string>> = {
  'too-large': (detail) => TOO_LARGE_DETAILS[detail] ?? detail,
  unreadable: (detail) => UNREADABLE_DETAILS[detail] ?? detail,
  'root-truncated': formatRootTruncatedDetail,
  'forbidden-field': (detail) => `field: ${detail}`,
  'unknown-field': (detail) => `field: ${detail}`,
};

const MUTATION_ERROR_COPY: Record<string, string> = {
  CUSTOM_AGENT_NOT_FOUND:
    'This agent is no longer on the machine. Press Rescan to refresh the list.',
  CUSTOM_AGENT_NO_WORKSPACE: 'This chatroom has no primary workspace.',
  NOT_AUTHORIZED_MACHINE: 'Only the owner of this machine can change its custom agents.',
};

/** A short, human explanation of an issue's raw `detail`, or null when absent. */
export function formatCustomAgentIssueDetail(issue: CustomAgentIssue): string | null {
  if (issue.detail === undefined) return null;
  const format = DETAIL_FORMATTERS[issue.reason];
  return format === undefined ? issue.detail : format(issue.detail);
}

function formatRootTruncatedDetail(detail: string): string {
  if (detail === 'entries') return 'too many entries to scan';
  const cap = /^agent cap (\d+)$/.exec(detail);
  return cap === null ? detail : `over the ${cap[1]}-agent folder limit`;
}

/** Copy for a failed disable/refresh mutation, preferring the backend code. */
export function customAgentMutationErrorMessage(error: unknown): string {
  const mapped = MUTATION_ERROR_COPY[errorCode(error) ?? ''];
  return mapped ?? errorFallback(error);
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ConvexError)) return undefined;
  const code = (error.data as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function errorFallback(error: unknown): string {
  return getErrorMessage(error, 'Could not send the change. Try again.');
}
