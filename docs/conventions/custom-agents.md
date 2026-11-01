---
type: best-practice
title: Custom agents
description: How user-authored agent files are laid out, validated, and resolved into a chatroom team.
tags: [agents, roles, custom-agents, conventions]
status: draft
---

# Custom agents

Custom agents are user-authored roles defined in files. They sit beside the builtin roles and, once loaded, merge into the chatroom team at read time. This guide is the authoritative description of their file layout, rules, and limits.

## Status

Shipped on `feat/custom-agents`:

- Shared domain rules: naming, limits, sanitization, issue reasons, and the pure team merge in `packages/shared/src/domain/custom-agent.ts`. The forbidden-key list is defined but not enforced until the loader ships.
- Convex storage and the sync write path in `services/backend/src/domain/usecase/custom-agents/sync-custom-agent-definitions.ts`, exposed by `services/backend/convex/customAgents.ts`.
- The single read-time resolver in `services/backend/src/domain/usecase/team/resolve-chatroom-team.ts`.

Not shipped yet:

- Daemon file loading and discovery of `.chatroom/agents` or `~/.chatroom/agents`.
- Loader-produced issues. `missing-frontmatter`, `invalid-frontmatter`, `name-mismatch`, `forbidden-field`, `unknown-field`, `gitignored`, `unreadable`, and `root-truncated` are in the issue vocabulary but are produced only by the loader; the server does not read frontmatter today.
- Prompt composition for custom roles, including their handoff templates and system prompts.
- Generated default handoff templates. Prompt composition is not shipped, so no default is rendered for a custom role.
- Registered-workspace check on sync. Workspace sources are not checked against the machine's registered workspaces, so an unregistered directory can store rows that never resolve. The check (`requireRegisteredWorkspaceForMachine`) lands with the first push path.
- CLI sync commands and any `chatroom` command for custom agents.
- Webapp management surfaces.
- A user-facing flow for disabling custom agents. The sync and resolver mechanism exists (see [Disable and sync](#disable-and-sync)), but no supported client surface drives it yet.

Treat the layout and parser rules below as approved design and stable conventions, not as behavior you can exercise end to end today.

## Where agents live

One directory per agent, in one of two scopes:

| Scope     | Path                                           | Committed? |
| --------- | ---------------------------------------------- | ---------- |
| Workspace | `<workspace>/.chatroom/agents/<name>/AGENT.md` | Yes        |
| Machine   | `~/.chatroom/agents/<name>/AGENT.md`           | No         |

A workspace agent travels with the repository, so teammates share it. A machine agent stays on one machine and is never committed.

Each agent directory may also contain:

- `inbound-handoff.md`: the template the entry point uses to delegate work to this agent.
- `return-handoff.md`: the template this agent uses to return work to the entry point.

Both are optional. A generated default is planned for when either file is absent, but no default is rendered yet (see [Status](#status)).

## AGENT.md format

`AGENT.md` is YAML frontmatter followed by the body. The frontmatter carries `name` and `description`; the body is the system prompt.

```markdown
---
name: example-reviewer
description: Reviews release notes for accuracy and completeness before publishing.
---

You are the release reviewer. Your job is to check release notes against the
changes they describe, flag missing migration steps, and return a short list of
corrections to the planner.

Hand off to the builder when a note reveals an unfinished implementation, and
return to the planner when the review is complete.
```

Rules:

- The directory name must equal the frontmatter `name`. A mismatch is reported as `name-mismatch`.
- `name` and `description` are the only allowed frontmatter keys.
- The body is the system prompt. State the role's purpose, responsibilities, when to hand off and to whom, and what to return.

The loader enforces these frontmatter rules when it ships; the server does not check frontmatter today.

## Handoff templates

Handoff templates are markdown with `## ` sections. Each file contains the message body only, not delimiter lines.

| File                 | Used by              | Purpose                                |
| -------------------- | -------------------- | -------------------------------------- |
| `inbound-handoff.md` | The team entry point | Delegating work to this agent          |
| `return-handoff.md`  | The custom agent     | Returning work to the team entry point |

When a file is absent, a generated default is planned but not rendered yet (see [Status](#status)). Keep authored templates at or below 4 KiB (4,096 UTF-8 bytes).

## Limits

| Constant                  | Value                       | Applies to                                                         |
| ------------------------- | --------------------------- | ------------------------------------------------------------------ |
| `nameMaxLength`           | 48 characters               | Agent name                                                         |
| `descriptionMaxLength`    | 200 characters              | Description after sanitization                                     |
| `systemPromptMaxBytes`    | 24 KiB (24,576 UTF-8 bytes) | `AGENT.md` body                                                    |
| `handoffTemplateMaxBytes` | 4 KiB (4,096 UTF-8 bytes)   | Each handoff template                                              |
| `agentsPerSource`         | 12                          | One workspace or machine source                                    |
| `agentsPerChatroom`       | 16                          | Enabled custom agents in one chatroom                              |
| `issuesPerSource`         | 50                          | Issues stored for one source snapshot, including server rejections |

A source that pushes more than `agentsPerSource` agents is rejected with `INVALID_SCOPE`. Only agents beyond `agentsPerChatroom` are reported as `over-limit`.

## Names, descriptions, and reserved names

Names are lowercase kebab-case matching `^[a-z0-9]+(-[a-z0-9]+)*$` and at most 48 characters. A malformed name is rejected with `invalid-name`.

Descriptions are one line of at most 200 characters. Control characters and newlines become spaces, `<`, `>`, and backticks are removed, whitespace collapses, and the result is truncated to the limit. An empty description is rejected with `invalid-description`. The sanitized description is the summary other agents see in the team roster.

Reserved names fail with `reserved-name`:

- Builtin agent roles.
- `user`.
- Retired roles such as `enhancer`.

Name collisions are reported as `shadowed`, and nothing throws. The workspace definition wins; the machine definition is dropped.

## Forbidden fields

Model and harness selection stays in Convex configuration and is never written to a role file. Once the loader ships, these frontmatter keys are rejected with `forbidden-field`:

`model`, `models`, `harness`, `harnesses`, `agentHarness`, `agent-harness`, `agent_harness`, `provider`

Once the loader ships, any other key besides `name` and `description` is reported as `unknown-field`.

## Issue reasons

`CUSTOM_AGENT_ISSUE_REASONS` is the complete vocabulary reported to clients:

| Reason                | Meaning                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `missing-frontmatter` | `AGENT.md` has no YAML frontmatter block.                           |
| `invalid-frontmatter` | The frontmatter cannot be parsed as a key/value mapping.            |
| `invalid-name`        | The name fails the lowercase kebab-case rule or the length cap.     |
| `name-mismatch`       | The frontmatter name differs from the directory name.               |
| `reserved-name`       | The name is a builtin role, `user`, or a retired role.              |
| `invalid-description` | The description is empty after sanitization.                        |
| `forbidden-field`     | A forbidden model or harness key is present.                        |
| `unknown-field`       | A frontmatter key other than `name` or `description` is present.    |
| `too-large`           | A body exceeds its UTF-8 byte cap.                                  |
| `reserved-delimiter`  | A body line equals `CHATROOM_HANDOFF_END` or `CHATROOM_NOTIFY_END`. |
| `unreadable`          | The file or directory cannot be read.                               |
| `root-truncated`      | A source root has more entries than it can scan.                    |
| `gitignored`          | A workspace agent lives under a `.chatroom/` that git ignores.      |
| `shadowed`            | A definition lost a name collision and was dropped.                 |
| `over-limit`          | A custom agent exceeded the per-chatroom enabled cap.               |

Reserved block tags in authored text are not neutralized in rendered prompts yet, because prompt composition for custom roles is not shipped. Prompt composition must call `neutralizeChatroomBlockTags` before rendering a stored system prompt or template body. Do not rely on `<handoffs>`, `<task>`, `<team-roster>`, or any other reserved tag to affect prompt structure.

## Lifecycle

Custom agents are always ephemeral and optional. There is no frontmatter override for lifecycle. A permanent custom role would block the setup wizard's `allJoined` gate, so lifecycle deliberately stays out of authored files.

## Disable and sync

Disable state and definition snapshots both arrive through a single write path, `syncDefinitions`. Definitions reach it from the daemon; disable state is stamped from the daemon's machine-local state and projected onto a chatroom by `resolveChatroomTeam`.

- **Disable is machine-local and keyed by name.** The flag lives on the synced definition, so it follows that machine's row for the role rather than a chatroom setting. Every chatroom resolving the same definition sees the same disabled state.
- **Disabled agents are removed before the 16-agent cap.** They never consume a per-chatroom slot, so disabling one agent cannot push another into `over-limit`.
- **The roster still shows disabled agents.** `getTeamRoster` lists every resolved role, including disabled custom agents with `disabled: true`, so a disabled role is visible rather than silently missing.
- **In-flight roles stay ephemeral.** A role already projected as ephemeral keeps the ephemeral lifecycle after its definition is removed or disabled, so release and handoff paths still run for work that is already assigned.
- **Only `duo` is supported.** `supportsCustomAgents` accepts `duo` alone, so `solo` and legacy structures never merge custom agents or treat custom names as ephemeral, regardless of what is synced.

A push replaces the snapshot for one source (`machineId` plus `scope` plus `workingDir`). The pushed source hash is advisory: the stored rules version, the canonical issues, and the server-recomputed per-agent hashes decide whether anything changed. An unchanged snapshot writes nothing except a disable-flag pass that patches only rows whose flag differs; any other change upserts the source row and reconciles the agents. A stored rules version that no longer matches forces a full rewrite. Disable flags are excluded from the content key, so a toggle patches the row in place and prompt and template bodies keep their ids. The server recomputes each definition hash instead of trusting the pushed value. None of this makes the daemon loader or prompt composition shipped: without the loader, nothing pushes a snapshot, and without prompt composition, a synced definition is not rendered into any prompt.

## Git and .gitignore

Commit workspace agents; never commit machine agents.

If `.chatroom/` is ignored by the repository, a workspace agent is reported with the `gitignored` issue once the loader ships and cannot be committed. Replace a bare `.chatroom` ignore rule with:

```gitignore
.chatroom/*
!.chatroom/agents/
```

Convex never reads the filesystem. Definitions reach Convex through the daemon or CLI sync path in a later slice.

## Invariants

- `duo@1` and `solo@1` stay immutable. Custom agents never rewrite a team structure id.
- Custom roles merge at read time through `resolveChatroomTeam`, which composes the builtin structure with enabled custom identities.
- Retired-role fallback is preserved: retired names are never selectable agents and reserved custom names are rejected.
- The backend never reads the filesystem; all file content arrives through a pushed definition snapshot.

## Source of truth

- [custom-agent.ts](../../packages/shared/src/domain/custom-agent.ts): limits, name pattern, forbidden keys, issue reasons, sanitization, and the merge.
- [agent-role.ts](../../packages/shared/src/domain/agent-role.ts): builtin and retired role identity.
- [resolve-chatroom-team.ts](../../services/backend/src/domain/usecase/team/resolve-chatroom-team.ts): the read-time merge point.
- [sync-custom-agent-definitions.ts](../../services/backend/src/domain/usecase/custom-agents/sync-custom-agent-definitions.ts): payload validation and storage reconciliation.
- [custom-agents skill](../../services/backend/src/domain/usecase/skills/modules/custom-agents/index.ts): the agent-facing authoring skill.

## Verify

```bash
pnpm --dir packages/shared exec vitest run \
  src/domain/custom-agent.test.ts \
  src/domain/agent-role.test.ts \
  src/domain/team-presets.test.ts

pnpm --dir services/backend exec vitest run \
  convex/customAgents.spec.ts \
  src/domain/entities/team-presets.spec.ts \
  src/domain/usecase/agent/start-agent-from-current-config.spec.ts
```
