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

- Shared domain rules: naming, limits, sanitization, issue reasons, and the pure team merge in `packages/shared/src/domain/custom-agent.ts`.
- Convex storage and the sync write path in `services/backend/src/domain/usecase/custom-agents/sync-custom-agent-definitions.ts`, exposed by `services/backend/convex/customAgents.ts`.
- The machine commands `setDisabled` and `requestRefresh`, which enqueue `daemon.customAgentsSetDisabled` and `daemon.customAgentsRefresh` (`services/backend/convex/customAgents.ts`).
- The single read-time resolver in `services/backend/src/domain/usecase/team/resolve-chatroom-team.ts`. It reads the chatroom's **primary workspace** only (`getPrimaryWorkspaceForChatroom`); machine-scope agents reach the team through that same workspace.
- The daemon loader and push service in `packages/cli/src/infrastructure/services/custom-agents/` and `packages/cli/src/daemon/services/custom-agents-service/`. The daemon is the only writer and pushes on daemon start, on every file change under either root (chokidar watchers), on a 60 s fallback poll, and when a rescan is requested.
- Prompt composition in `services/backend/prompts/custom-agents/`: a custom role renders its own instructions and return handoff template, and the entry point renders a roster plus one inbound template per enabled delegate.
- The Custom Agents settings tab (`apps/webapp/src/modules/chatroom/components/custom-agents/CustomAgentsTab.tsx`), which shows what the machine loaded, reports every issue, and toggles agents or requests a rescan.
- The custom-agent commands (`packages/cli/src/commands/custom-agents/`): `validate`, which is offline and prints what the loader sees, and the authenticated `list`, `enable`, `disable`, and `refresh`, which call the same `getTeamRoster`, `setDisabled`, and `requestRefresh` functions the settings tab uses. `enable` and `disable` print `confirmed` once the pushed roster shows the new value, or time out after 10 s.

A change reaches the UI near-instantly on a running daemon, because the watchers push within the debounce window. When a root does not exist yet, the loader cannot watch it; creating `.chatroom/agents` is picked up by the 60 s fallback poll, so the worst case is about a minute. Rescan forces it immediately.

Not shipped:

- `chatroom handoff view-template` and `list-templates` for custom roles: the handoff catalogs cover builtin roles only.
- Editing `AGENT.md` from the webapp. The tab shows what the machine loaded; authoring happens in the editor.
- Model or harness selection for custom agents.
- Non-primary workspaces: only the chatroom's primary workspace contributes agents, so a second registered workspace's agents do not merge.
- Orphan cleanup of rows for removed workspaces.

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

Model and harness selection stays in Convex configuration and is never written to a role file. These frontmatter keys are reported with `forbidden-field`:

`model`, `models`, `harness`, `harnesses`, `agentHarness`, `agent-harness`, `agent_harness`, `provider`

Any other key besides `name` and `description` is reported as `unknown-field`.

Both are advisory flags, not rejections: the agent still loads and joins the team, and the key is never honoured. The loader ignores the value; only `name` and `description` are read.

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

Prompt composition neutralises every authored string before rendering it: the system prompt, both handoff templates, and the description all pass through `neutralizeChatroomBlockTags`, so a reserved opening delimiter such as `<handoffs>`, `<task>`, `<team-roster>`, or `<custom-agent-instructions>` is escaped. Authored text therefore cannot impersonate protocol markup. Generated defaults are not neutralised because they are already free of reserved tags.

## Lifecycle

Custom agents are always ephemeral and optional. There is no frontmatter override for lifecycle. A permanent custom role would block the setup wizard's `allJoined` gate, so lifecycle deliberately stays out of authored files.

## Disable and sync

Disable state and definition snapshots both arrive through a single write path, `syncDefinitions`. Definitions reach it from the daemon; disable state is stamped from the daemon's machine-local state and projected onto a chatroom by `resolveChatroomTeam`.

- **Disable is machine-local and keyed by name.** The flag lives on the synced definition, so it follows that machine's row for the role rather than a chatroom setting. Every chatroom resolving the same definition sees the same disabled state.
- **Disabled agents are removed before the 16-agent cap.** They never consume a per-chatroom slot, so disabling one agent cannot push another into `over-limit`.
- **The roster still shows disabled agents.** `getTeamRoster` lists every resolved role, including disabled custom agents with `disabled: true`, so a disabled role is visible rather than silently missing.
- **In-flight roles stay ephemeral.** A role already projected as ephemeral keeps the ephemeral lifecycle after its definition is removed or disabled, so release and handoff paths still run for work that is already assigned.
- **Disable is stored on the machine.** The daemon keeps `~/.chatroom/daemon/<machineId>/custom-agents-disabled.json`, applies it by re-pushing, and the next push carries the flag. Disabling is reversible: enabling re-pushes with `disabled: false`.
- **Only the machine owner can toggle or rescan.** `setDisabled` and `requestRefresh` enqueue a command, and a caller who does not own the machine gets `NOT_AUTHORIZED_MACHINE`.
- **A working agent keeps working.** Disabling hides the role from the team for new work; an agent already on a task finishes that task and hands off normally.
- **Only `duo` is supported.** `supportsCustomAgents` accepts `duo` alone, so `solo` and legacy structures never merge custom agents or treat custom names as ephemeral, regardless of what is synced.

A push replaces the snapshot for one source (`machineId` plus `scope` plus `workingDir`). The pushed source hash is advisory: the stored rules version, the canonical issues, and the server-recomputed per-agent hashes decide whether anything changed. An unchanged snapshot writes nothing except a disable-flag pass that patches only rows whose flag differs; any other change upserts the source row and reconciles the agents. A stored rules version that no longer matches forces a full rewrite. Disable flags are excluded from the content key, so a toggle patches the row in place and prompt and template bodies keep their ids. The server recomputes each definition hash instead of trusting the pushed value, and an unchanged snapshot writes nothing.

## Trust model

A workspace agent arrives with the repository, so it is exactly as trusted as any other file in a cloned repo, and this page treats it like `AGENTS.md`:

- Descriptions are sanitised to one display line; bodies are neutralised before rendering, so authored markup cannot impersonate protocol blocks.
- A workspace agent is **enabled by default** when it loads. Nothing asks the user to approve it.
- The planner (the team entry point) may delegate work to a repo-supplied agent, because it appears in the roster exactly like an authored-by-you agent.

Treat cloning a repository as trusting the agents it ships, the same way you trust its `AGENTS.md`. Disable an agent from the Custom Agents tab if you do not want it used on this machine.

## Git and .gitignore

Commit workspace agents; never commit machine agents.

`gitignored` is advisory. It is reported only for workspace scope, only when `<workspace>/.git` exists, and only when git would ignore `.chatroom/agents/<name>/AGENT.md`. The agent still loads and resolves; the issue is a warning that teammates will not receive it. `chatroom` writes this rule into a project's `.gitignore` (`packages/cli/src/tools/output.ts`):

```gitignore
.chatroom/*
!.chatroom/agents/
```

If a repository ignores `.chatroom/` wholesale, replace the bare `.chatroom` rule with:

```gitignore
.chatroom/*
!.chatroom/agents/
```

Convex never reads the filesystem. Definitions reach Convex only through the daemon's push; there is no CLI sync command.

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
- [prompts/custom-agents](../../services/backend/prompts/custom-agents/): the instruction, return-handoff, and roster renderers, plus the generated defaults.
- [load-custom-agent-source.ts](../../packages/cli/src/infrastructure/services/custom-agents/load-custom-agent-source.ts): the daemon loader (frontmatter, containment, caps, `gitignored`).
- [custom-agents-service.ts](../../packages/cli/src/daemon/services/custom-agents-service/custom-agents-service.ts): the daemon push scheduler, retries, and disable-state application.
- [CustomAgentsTab.tsx](../../apps/webapp/src/modules/chatroom/components/custom-agents/CustomAgentsTab.tsx): the webapp tab.
- [custom-agents skill](../../services/backend/src/domain/usecase/skills/modules/custom-agents/index.ts): the agent-facing authoring skill.

## Verify

```bash
pnpm --dir packages/shared exec vitest run \
  src/domain/custom-agent.test.ts \
  src/domain/agent-role.test.ts \
  src/domain/team-presets.test.ts

pnpm --dir packages/cli exec vitest run \
  src/infrastructure/services/custom-agents \
  src/daemon/services/custom-agents-service \
  src/commands/custom-agents

pnpm --dir services/backend exec vitest run \
  convex/customAgents.spec.ts \
  convex/customAgents.commands.spec.ts \
  convex/customAgents.prompt-wiring.spec.ts \
  convex/customAgents.daemon-replay.spec.ts \
  convex/skills.spec.ts \
  prompts/custom-agents \
  src/domain/entities/team-presets.spec.ts \
  src/domain/usecase/agent/start-agent-from-current-config.spec.ts

pnpm --dir apps/webapp exec vitest run \
  src/modules/chatroom/components/custom-agents \
  src/modules/chatroom/components/AgentSettingsModal.custom-agents-tab.test.tsx
```

The downstream Playwright spec `apps/webapp/tests/e2e/specs/downstream/custom-agents-settings.spec.ts` covers the full loop (toggle, daemon command, push, roster) and needs a running Convex deployment.
