import type { SkillModule } from '../../registry';

export const customAgentsSkill: SkillModule = {
  skillId: 'custom-agents',
  name: 'Custom Agents',
  description:
    'Use when creating, editing, or reviewing custom agents: file layout, frontmatter, handoff templates, limits, and the conventions they must follow.',

  getPrompt: (cliEnvPrefix: string) => `You have been activated with the "custom-agents" skill.

# Custom Agents

Custom agents are user-authored roles defined in files. The daemon loads \`.chatroom/agents\` and \`~/.chatroom/agents\`, validates every file, and pushes the snapshot to Convex; the chatroom team then lists each agent as an optional role. Custom agents work only on duo teams.

The daemon pushes on start, on every file change under either root, on a 60 s fallback poll, and when someone presses Rescan in the webapp or runs \`chatroom custom-agents refresh\`. A file you create appears in the chatroom within about a minute at worst, and almost immediately once the agent folder already exists.

Run \`${cliEnvPrefix}chatroom custom-agents validate\` from the workspace to see exactly what the loader found and every issue it reported. Add \`--machine\` for the machine scope only, or \`--workspace <dir>\` for another directory. The command is offline: no auth and no backend call.

## Layout

One directory per agent, in one of two scopes:

\`\`\`text
<workspace>/.chatroom/agents/<name>/AGENT.md      # workspace scope, committed to git
~/.chatroom/agents/<name>/AGENT.md                # machine scope, never committed
\`\`\`

Each agent directory may also contain:

- \`inbound-handoff.md\` — the template the team entry point uses to delegate to this agent.
- \`return-handoff.md\` — the template this agent uses to return to the entry point.

Both handoff files are optional. When either file is absent, prompt composition renders a generated default, so a teammate always gets a usable structure.

Workspace agents are committed with the repo, so teammates share them. Machine agents stay on one machine and are never committed.

\`gitignored\` is advisory: it is reported only for workspace scope, only when the repository has a \`.git\`, and only when git would ignore \`.chatroom/agents/<name>/AGENT.md\`. The agent still loads; the issue means teammates will not receive it. The rule \`chatroom\` writes into a project's \`.gitignore\` is:

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

- \`name\` is required and must match the directory name exactly. A mismatch is reported as \`name-mismatch\` and the agent is not loaded.
- \`description\` is required and is the one-line summary other agents see in the team roster.
- The body is the system prompt. Write it in the second person and state the role's purpose, responsibilities, handoff points, and what it must return.

## Handoff templates

Handoff templates are markdown with \`## \` sections. Each file contains the message body only; do not include the \`---MESSAGE---\` line or the \`CHATROOM_HANDOFF_END\` and \`CHATROOM_NOTIFY_END\` closing lines.

- \`inbound-handoff.md\` is what the entry point sends when delegating work to this agent.
- \`return-handoff.md\` is what this agent sends when returning work to the entry point.

Cover the task summary, the context the recipient needs, and the expected result. Keep each template at or below 4 KiB (4,096 UTF-8 bytes). When the generated default is adequate, omit the file rather than copying it.

Two constraints apply to every authored body:

- A body line equal to \`CHATROOM_HANDOFF_END\` or \`CHATROOM_NOTIFY_END\` is rejected with the \`reserved-delimiter\` issue, because it would truncate the handoff payload.
- Authored system prompts, handoff templates, and descriptions are neutralised before rendering: a reserved opening delimiter such as \`<handoffs>\`, \`<task>\`, \`<team-roster>\`, or \`<custom-agent-instructions>\` is escaped, so authored text cannot impersonate protocol markup. Write normal markdown and do not rely on reserved tags for structure.

## Name, description, and size rules

- **Name:** lowercase kebab-case matching \`^[a-z0-9]+(-[a-z0-9]+)*$\`, at most 48 characters. A malformed name is rejected with \`invalid-name\`.
- **Description:** one line of at most 200 characters. Control characters and newlines become spaces, \`<\`, \`>\`, and backticks are stripped, and whitespace is collapsed. An empty description is rejected with \`invalid-description\`.
- **System prompt:** at most 24 KiB (24,576 UTF-8 bytes).
- **Handoff templates:** at most 4 KiB (4,096 UTF-8 bytes) each.
- **Agent counts:** at most 12 agents per source (workspace or machine) and at most 16 enabled custom agents per chatroom. Agents beyond the per-chatroom cap are not enabled and are reported with \`over-limit\`; a source that pushes more than 12 is rejected with \`INVALID_SCOPE\`.

Caps are enforced, not advisory: an oversized definition is rejected with \`too-large\`, and a per-chatroom overflow is reported as \`over-limit\` rather than silently dropped.

## Forbidden fields and reserved names

These frontmatter keys are forbidden because model and harness selection belongs to the chatroom, not to a role file, and must never be committed:

\`model\`, \`models\`, \`harness\`, \`harnesses\`, \`agentHarness\`, \`agent-harness\`, \`agent_harness\`, \`provider\`

A definition using one of them is reported with \`forbidden-field\`. Any other key besides \`name\` and \`description\` is reported with \`unknown-field\`. Both are advisory: the agent still loads, and the key is never honoured — the loader reads only \`name\` and \`description\`. Remove the field to clear the issue.

Reserved names fail with \`reserved-name\`:

- Builtin agent roles.
- \`user\`.
- Retired roles such as \`enhancer\`.

Name collisions are never silent. A workspace agent wins a clash with a machine agent, and the shadowed definition is reported with the \`shadowed\` issue.

Custom agents are always ephemeral and optional. There is no frontmatter override for lifecycle. A permanent custom role would block the setup wizard, so lifecycle stays out of authored files.

## Enable, disable, and rescan

Disable is machine-local and keyed by the agent name: turning off \`reviewer-x\` also disables any other agent called \`reviewer-x\` on that machine, in every chatroom that resolves the name. Only the owner of the machine can do it.

From a terminal:

\`\`\`text
${cliEnvPrefix}chatroom custom-agents list --chatroom-id=<id>
${cliEnvPrefix}chatroom custom-agents disable --chatroom-id=<id> --name=<name>
${cliEnvPrefix}chatroom custom-agents enable --chatroom-id=<id> --name=<name>
${cliEnvPrefix}chatroom custom-agents refresh --chatroom-id=<id>
\`\`\`

The same actions live in the Custom Agents section of the chatroom settings: the switch on each row, and Rescan. \`disable\` and \`enable\` print \`confirmed\` once the pushed roster shows the new value, or say the change is still pending after ten seconds. The change is persisted by the machine and applied through the next push.

Disabling is reversible. An agent that is already working keeps working on its current task and hands off normally.

## Authoring checklist

1. Create one directory named for the role: \`.chatroom/agents/<name>/\` or \`~/.chatroom/agents/<name>/\`.
2. Make the frontmatter \`name\` identical to the directory name, in lowercase kebab-case within 48 characters.
3. Write a single-line \`description\` within 200 characters; this is the roster summary other agents read.
4. Put the system prompt in the body: purpose, responsibilities, when to hand off and to whom, and what to return.
5. Add \`inbound-handoff.md\` and \`return-handoff.md\` only when the generated defaults are insufficient; keep each at or below 4 KiB.
6. Keep the system prompt at or below 24 KiB and avoid reserved delimiters and protocol tags in authored text.
7. Do not add model or harness fields; choose those in the chatroom instead.
8. For workspace agents, make sure \`.chatroom/\` is not ignored wholesale so the definition can be committed.
9. Run \`${cliEnvPrefix}chatroom custom-agents validate\` and fix every issue it reports.
`,
};
