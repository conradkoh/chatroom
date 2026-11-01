import {
  CUSTOM_AGENT_ISSUE_REASONS,
  CUSTOM_AGENT_LIMITS,
  type CustomAgentIssue,
} from '@workspace/shared/domain/custom-agent';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import {
  CUSTOM_AGENT_DISPLACED_MESSAGE,
  CUSTOM_AGENT_ISSUE_COPY,
  CUSTOM_AGENT_OVER_LIMIT_MESSAGE,
  CUSTOM_AGENT_TOGGLE_TIMEOUT_MESSAGE,
  customAgentMutationErrorMessage,
  formatCustomAgentIssueDetail,
} from './customAgentCopy';

function issue(detail?: string): CustomAgentIssue {
  return detail === undefined
    ? { path: 'x', reason: 'too-large' }
    : { path: 'x', reason: 'too-large', detail };
}

describe('CUSTOM_AGENT_ISSUE_COPY', () => {
  it.each(CUSTOM_AGENT_ISSUE_REASONS)('has copy for %s', (reason) => {
    const copy = CUSTOM_AGENT_ISSUE_COPY[reason];

    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.action.length).toBeGreaterThan(0);
    expect(['warning', 'info']).toContain(copy.tone);
  });

  it('interpolates limits from the shared constants', () => {
    expect(CUSTOM_AGENT_ISSUE_COPY['invalid-name'].action).toContain(
      String(CUSTOM_AGENT_LIMITS.nameMaxLength)
    );
    expect(CUSTOM_AGENT_ISSUE_COPY['root-truncated'].action).toContain(
      String(CUSTOM_AGENT_LIMITS.agentsPerSource)
    );
    expect(CUSTOM_AGENT_ISSUE_COPY['over-limit'].title).toContain(
      String(CUSTOM_AGENT_LIMITS.agentsPerChatroom)
    );
    expect(CUSTOM_AGENT_ISSUE_COPY['too-large'].action).toContain(
      `${CUSTOM_AGENT_LIMITS.systemPromptMaxBytes / 1024} KB`
    );
    expect(CUSTOM_AGENT_ISSUE_COPY['too-large'].action).toContain(
      `${CUSTOM_AGENT_LIMITS.handoffTemplateMaxBytes / 1024} KB`
    );
  });
});

describe('formatCustomAgentIssueDetail', () => {
  it('returns null without a detail', () => {
    expect(formatCustomAgentIssueDetail(issue())).toBeNull();
  });

  it.each([
    ['systemPrompt', 'AGENT.md body'],
    ['inboundHandoffTemplate', 'inbound-handoff.md'],
    ['returnHandoffTemplate', 'return-handoff.md'],
  ])('maps too-large %s', (detail, expected) => {
    expect(formatCustomAgentIssueDetail({ path: 'x', reason: 'too-large', detail })).toBe(expected);
  });

  it.each([
    ['symlink', 'symlinks are not followed'],
    ['not-directory', 'not a folder'],
    ['root-outside-workspace', 'folder points outside the workspace'],
    ['EACCES', 'permission denied'],
    ['EPERM', 'permission denied'],
  ])('maps unreadable %s', (detail, expected) => {
    expect(formatCustomAgentIssueDetail({ path: 'x', reason: 'unreadable', detail })).toBe(
      expected
    );
  });

  it('maps root-truncated details', () => {
    expect(
      formatCustomAgentIssueDetail({ path: 'x', reason: 'root-truncated', detail: 'entries' })
    ).toBe('too many entries to scan');
    expect(
      formatCustomAgentIssueDetail({ path: 'x', reason: 'root-truncated', detail: 'agent cap 12' })
    ).toBe('over the 12-agent folder limit');
  });

  it('prefixes field names for frontmatter key issues', () => {
    expect(
      formatCustomAgentIssueDetail({ path: 'x', reason: 'forbidden-field', detail: 'model' })
    ).toBe('field: model');
    expect(
      formatCustomAgentIssueDetail({ path: 'x', reason: 'unknown-field', detail: 'notes' })
    ).toBe('field: notes');
  });

  it('falls back to the raw detail for unmapped reasons and details', () => {
    expect(formatCustomAgentIssueDetail({ path: 'x', reason: 'too-large', detail: 'other' })).toBe(
      'other'
    );
    expect(
      formatCustomAgentIssueDetail({ path: 'x', reason: 'name-mismatch', detail: 'alpha vs beta' })
    ).toBe('alpha vs beta');
  });
});

describe('customAgentMutationErrorMessage', () => {
  it.each([
    [
      'CUSTOM_AGENT_NOT_FOUND',
      'This agent is no longer on the machine. Press Rescan to refresh the list.',
    ],
    ['CUSTOM_AGENT_NO_WORKSPACE', 'This chatroom has no primary workspace.'],
    ['NOT_AUTHORIZED_MACHINE', 'Only the owner of this machine can change its custom agents.'],
  ])('maps the %s code', (code, expected) => {
    expect(customAgentMutationErrorMessage(new ConvexError({ code, message: 'x' }))).toBe(expected);
  });

  it('falls back to the error message for a plain Error', () => {
    expect(customAgentMutationErrorMessage(new Error('network down'))).toBe('network down');
  });

  it('falls back to the generic copy for an unknown value', () => {
    expect(customAgentMutationErrorMessage(undefined)).toBe(
      'Could not send the change. Try again.'
    );
    expect(customAgentMutationErrorMessage('nope')).toBe('Could not send the change. Try again.');
  });

  it('exposes the timeout copy', () => {
    expect(CUSTOM_AGENT_TOGGLE_TIMEOUT_MESSAGE).toContain('The machine did not respond');
  });

  it('states the per-chatroom cap in the over-limit message', () => {
    expect(CUSTOM_AGENT_OVER_LIMIT_MESSAGE).toContain(
      `${CUSTOM_AGENT_LIMITS.agentsPerChatroom} custom agents`
    );
  });

  it('says a capped agent joins on its own instead of claiming it was left off', () => {
    // The enable is stored, so the copy must not tell the user to turn the agent
    // on again: a freed slot lets it join without another action.
    expect(CUSTOM_AGENT_OVER_LIMIT_MESSAGE).not.toContain('not turned on');
    expect(CUSTOM_AGENT_OVER_LIMIT_MESSAGE).toContain('joins when another one is turned off');
  });

  it('explains a displaced agent with the same join-on-its-own promise', () => {
    expect(CUSTOM_AGENT_DISPLACED_MESSAGE).toContain('Not in use');
    expect(CUSTOM_AGENT_DISPLACED_MESSAGE).toContain(
      `${CUSTOM_AGENT_LIMITS.agentsPerChatroom} custom agents`
    );
    expect(CUSTOM_AGENT_DISPLACED_MESSAGE).toContain('joins when another one is turned off');
  });
});
