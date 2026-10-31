import type { SkillModule } from '../../registry';

export const customAgentsSkill: SkillModule = {
  skillId: 'custom-agents',
  name: 'Custom Agents',
  description:
    'Use when creating, editing, or reviewing custom agents: file layout, frontmatter, handoff templates, limits, and the conventions they must follow.',

  getPrompt: (_cliEnvPrefix: string) => `You have been activated with the "custom-agents" skill.

# Custom Agents

Custom agents are user-authored roles defined in files. They join the chatroom team beside the builtin roles and receive the same task, handoff, and lifecycle handling.

## Layout

One directory per agent, in one of two scopes:

\`\`\`text
<workspace>/.chatroom/agents/<name>/AGENT.md      # workspace scope, committed to git
~/.chatroom/agents/<name>/AGENT.md                # machine scope, never committed
\`\`\`

Each agent directory may also contain:

- \`inbound-handoff.md\` — the template the team entry point uses to delegate to this agent (max 4 KiB).
- \`return-handoff.md\` — the template this agent uses to return to the entry point (max 4 KiB).

Both handoff files are optional. When either file is absent, a generated default is used.

Workspace agents are committed with the repo, so teammates share them. Machine agents stay on one machine and are never committed.

If \`.chatroom/\` is ignored by the repository, a workspace agent is reported with the \`gitignored\` issue and cannot be committed. Replace a bare \`.chatroom\` ignore rule with:

\`\`\`text
.chatroom/*
!.chatroom/agents/
\`\`\`

## AGENT.md format

\`AGENT.md\` is YAML frontmatter followed by the body:

\`\`\`markdown
---
name: release-reviewer
description: Reviews release notes for accuracy and completeness before publishing.
---

You are the release reviewer. Your job is to ...
\`\`\`

- \`name\` is required and must match the directory name exactly. A mismatch is reported as the \`name-mismatch\` issue.
- \`description\` is required and is the one-line summary other agents see in the team roster.
- The body is the system prompt. Write it in the second person and state the role's purpose, responsibilities, handoff points, and what it must return.

## Handoff templates

Handoff templates are markdown with \`## \` sections. Each file contains the message body only; do not include delimiter lines such as \`---MESSAGE---\`.

- \`inbound-handoff.md\` is what the entry point sends when delegating work to this agent.
- \`return-handoff.md\` is what this agent sends when returning work to the entry point.

Cover the task summary, the context the recipient needs, and the expected result. Keep each template at or below 4 KiB (4,096 UTF-8 bytes). When the default template is adequate, omit the file rather than copying the default.

Two constraints apply to every authored body:

- A body line equal to \`CHATROOM_HANDOFF_END\` or \`CHATROOM_NOTIFY_END\` is rejected with the \`reserved-delimiter\` issue, because it would truncate the handoff payload.
- Protocol tags are neutralized, so do not rely on authored \`<handoffs>\`, \`<task>\`, \`<team-roster>\`, or other reserved block tags. Their opening delimiters are escaped in rendered prompts.

## Name, description, and size rules

- **Name:** lowercase kebab-case matching \`^[a-z0-9]+(-[a-z0-9]+)*$\`, at most 48 characters. A malformed name is rejected with \`invalid-name\`.
- **Description:** one line of at most 200 characters. Control characters and newlines become spaces, \`<\`, \`>\`, and backticks are stripped, and whitespace is collapsed. An empty description is rejected with \`invalid-description\`.
- **System prompt:** at most 24 KiB (24,576 UTF-8 bytes).
- **Handoff templates:** at most 4 KiB (4,096 UTF-8 bytes) each.
- **Agent counts:** at most 12 agents per source (workspace or machine) and at most 16 enabled custom agents per chatroom. Agents beyond the per-chatroom cap are not enabled and are reported with \`over-limit\`; a source that pushes more than 12 is rejected.

Caps are enforced, not advisory: an oversized definition is rejected with \`too-large\`, and a per-chatroom overflow is reported as \`over-limit\` rather than silently dropped.

## Forbidden fields and reserved names

These frontmatter keys are forbidden because model and harness selection belongs to the chatroom, not to a role file, and must never be committed:

\`model\`, \`models\`, \`harness\`, \`harnesses\`, \`agentHarness\`, \`agent-harness\`, \`agent_harness\`, \`provider\`

A definition using one of them is rejected with the \`forbidden-field\` issue.

Reserved names fail with \`reserved-name\`:

- Builtin agent roles.
- \`user\`.
- Retired roles such as \`enhancer\`.

Name collisions are never silent. A workspace agent wins a clash with a machine agent, and the shadowed definition is reported with the \`shadowed\` issue.

Custom agents are always ephemeral and optional. There is no frontmatter override for lifecycle. A permanent custom role would block the setup wizard, so lifecycle stays out of authored files.

## Authoring checklist

1. Create one directory named for the role: \`.chatroom/agents/<name>/\` or \`~/.chatroom/agents/<name>/\`.
2. Make the frontmatter \`name\` identical to the directory name, in lowercase kebab-case within 48 characters.
3. Write a single-line \`description\` within 200 characters; this is the roster summary other agents read.
4. Put the system prompt in the body: purpose, responsibilities, when to hand off and to whom, and what to return.
5. Add \`inbound-handoff.md\` and \`return-handoff.md\` only when the generated defaults are insufficient; keep each at or below 4 KiB.
6. Keep the system prompt at or below 24 KiB and avoid reserved delimiters and protocol tags in authored text.
7. Do not add model or harness fields; choose those in the chatroom instead.
8. For workspace agents, make sure \`.chatroom/\` is not ignored wholesale so the definition can be committed.
`,
};
