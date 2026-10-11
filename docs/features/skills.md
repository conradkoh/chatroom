# Feature: Chatroom Skills System

**Status:** Implemented (MVP)
**Last Updated:** 2026-03-15

---

## 1. Product Requirements Document (PRD)

### 1.1 Overview

The Chatroom Skills system introduces a new first-class concept — a **skill** — that encapsulates a reusable, named workflow the user can invoke from the CLI. Skills allow agents and users to compose multi-step automation without hardcoding individual commands.

The initial motivation is to replace one-off CLI operations (e.g., manual backlog scoring) with a declarative skill-based approach: `chatroom skill activate <skill-name>`.

### 1.2 Problem Statement

- Users regularly execute multi-step workflows (e.g., score all backlog items by complexity/value/priority) that currently require either multiple manual CLI commands or custom scripts.
- There is no canonical way to define, share, or discover reusable workflows inside a chatroom.
- There is no web UI integration for workflow management.

### 1.3 Goals

1. **CLI invocation**: A user can run `chatroom skill activate <skill-name> --chatroom-id=<id> --role=<role>` to trigger a named, predefined workflow.
2. **Backend as source of truth**: Skills are stored in the Convex backend and fetched by the CLI at runtime, so skills can be added/updated without CLI releases.
3. **Built-in skills**: Ship one built-in skill out of the box — `backlog-score` — which triggers an agent to score all unscored backlog items.
4. **Future custom skills**: The data model must support user-created skills via the web UI (future phase, not in MVP scope).
5. **Discovery**: A user can run `chatroom skill list --chatroom-id=<id>` to see available skills.

### 1.4 Non-Goals (MVP)

- Web UI for creating/editing custom skills (future phase).
- Skill versioning or rollback.
- Skill output streaming / live progress.
- Parametrized skills (dynamic arguments beyond skill name).
- Skill chaining or pipelines.

### 1.5 User Stories

| #   | As a…       | I want to…                                              | So that…                                                                                      |
| --- | ----------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | User        | Run `chatroom skill activate backlog-score`             | Agents automatically score all unscored backlog items without me manually triggering each one |
| 2   | User        | Run `chatroom skill list`                               | I can discover which skills are available to me                                               |
| 3   | User        | See skill status feedback in the CLI                    | I know the skill was accepted and is running                                                  |
| 4   | Developer   | Add built-in skills without releasing a new CLI version | Built-ins can be improved over time centrally                                                 |
| 5   | Future user | Create custom skills via the web UI                     | I can define organization-specific workflows                                                  |

### 1.6 UX & CLI Interface

```bash
# List available skills
chatroom skill list --chatroom-id=<id> --role=<role>

# Activate a skill
chatroom skill activate backlog-score --chatroom-id=<id> --role=<role>
```

**Expected output (activate):**

```
✅ Skill "backlog-score" activated.
   The agent will now score all unscored backlog items.
```

**Expected output (list):**

```
Available skills:
  backlog-score  Score all unscored backlog items by complexity, value, and priority
```

### 1.7 Built-in Skill: `backlog-score`

- **Trigger**: CLI runs `chatroom skill activate backlog-score ...`
- **Effect**: Posts a special message/task to the chatroom that instructs the planner agent to score all unscored backlog items
- **Agent behavior**: The planner receives the skill activation as a structured task and executes the backlog-scoring workflow (querying unscored items, then calling `backlog score` for each)

---

## 2. Data Model

### 2.1 New Table: `chatroom_skills`

Stored in Convex. Each row defines one skill available to a chatroom.

```ts
chatroom_skills: {
  chatroomId: Id<'chatroom_rooms'>; // Scope: chatroom-level
  skillId: string; // Stable identifier, e.g. "backlog-score"
  name: string; // Human-readable name
  description: string; // What the skill does
  type: 'builtin' | 'custom'; // Source of skill
  isEnabled: boolean; // Can be disabled
  prompt: string; // Instruction injected into the task when activated
  createdAt: number;
  updatedAt: number;
}
```

**Indexes:**

- `by_chatroom`: `['chatroomId']`
- `by_chatroom_skillId`: `['chatroomId', 'skillId']`

### 2.2 Built-in Skill Seeds

Built-in skills are seeded into each chatroom at creation time (or on first use via an upsert). They cannot be deleted but can be disabled.

---

## 3. Backend API

### 3.1 Queries

| Function      | Description                            |
| ------------- | -------------------------------------- |
| `skills.list` | List all enabled skills for a chatroom |
| `skills.get`  | Get a skill by skillId for a chatroom  |

### 3.2 Mutations

| Function          | Description                                                                          |
| ----------------- | ------------------------------------------------------------------------------------ |
| `skills.activate` | Activate a skill — validates skill exists, creates a task with skill prompt injected |
| `skills.seed`     | Upsert built-in skills for a chatroom (called internally)                            |

---

## 4. CLI Commands

New top-level command group: `chatroom skill`

### 4.1 `chatroom skill list`

```
chatroom skill list --chatroom-id=<id> --role=<role>
```

- Fetches skills from backend via `skills.list` query
- Displays name, description, enabled state

### 4.2 `chatroom skill activate <skill-name>`

```
chatroom skill activate <skill-name> --chatroom-id=<id> --role=<role>
```

- Calls `skills.activate` mutation with the chatroom-id, role, and skill name
- Backend seeds built-ins if not present, validates the skill name, then creates an activation task
- CLI prints success/error message

---

## 5. Implementation Plan

### Phase 1: Domain Model & Schema

**Goal:** Define the `chatroom_skills` table in the Convex schema and the domain entities.

- Add `chatroom_skills` table to `schema.ts`
- Define TypeScript types for `Skill` entity
- No behavior yet — just the data shape

**Acceptance Criteria:**

- `schema.ts` compiles with the new table and indexes
- `pnpm typecheck` passes

---

### Phase 2: Backend — Seed & Query

**Goal:** Backend can seed built-in skills and list them.

- Add `services/backend/convex/skills.ts` with:
  - `skills.list` query — returns all enabled skills for a chatroom
  - `skills.get` query — returns a skill by skillId
  - `skills.seed` internal mutation — upserts built-in skills for a chatroom
- Define the `backlog-score` built-in skill (prompt text)
- Export from `_generated/api` (automatic via Convex)

**Acceptance Criteria:**

- Queries return correct results
- Seed is idempotent
- `pnpm typecheck` passes

---

### Phase 3: Backend — Activate Mutation

**Goal:** Activating a skill creates a task with the skill's prompt.

- Add `skills.activate` mutation in `skills.ts`:
  - Validates chatroom access (session required)
  - Seeds built-ins if not already present
  - Looks up skill by name
  - Creates a `pending` task with `content = skill.prompt`
  - Returns `{ success: true, skill: { name, description } }`

**Acceptance Criteria:**

- Mutation creates a task visible to the agent
- Invalid skill name returns a clear error
- `pnpm typecheck` passes

---

### Phase 4: CLI — `skill list` Command

**Goal:** Users can discover available skills via CLI.

- Create `packages/cli/src/commands/skill/` directory
- Implement `list` subcommand that calls `skills.list` query
- Register `chatroom skill list` in `index.ts`

**Acceptance Criteria:**

- `chatroom skill list --chatroom-id=<id> --role=<role>` prints available skills
- Shows name, description for each skill
- Empty state message if none available

---

### Phase 5: CLI — `skill activate` Command

**Goal:** Users can activate a skill from the CLI.

- Implement `activate` subcommand that calls `skills.activate` mutation
- Register `chatroom skill activate <name>` in `index.ts`
- Print success feedback

**Acceptance Criteria:**

- `chatroom skill activate backlog-score --chatroom-id=<id> --role=<role>` succeeds
- Error message for unknown skill name
- `pnpm typecheck` and `pnpm test` pass

---

### Phase 6: Integration Test & PR

**Goal:** End-to-end test, cleanup, and raise PR.

- Write a unit test for `skills.activate` (verify task created with correct content)
- Final typecheck and lint pass
- Raise PR against master

---

## 6. Open Questions / Future Work

- Should skills be scoped to a chatroom or globally available (system-level)?
  - **Decision (MVP)**: Chatroom-scoped, with built-ins seeded per chatroom. Global scope deferred to future.
- Should the `backlog-score` skill include a structured arg for how many items to score?
  - **Decision (MVP)**: No parameters. Skill always scores all unscored items.
- Web UI for creating custom skills — future phase, not in scope here.

---

## 7. Related Files

| Area         | File                                      |
| ------------ | ----------------------------------------- |
| Schema       | `services/backend/convex/schema.ts`       |
| Backend      | `services/backend/convex/skills.ts` (new) |
| CLI entry    | `packages/cli/src/index.ts`               |
| CLI commands | `packages/cli/src/commands/skill/` (new)  |

---

## 8. Implementation Notes

All phases implemented in branch `fix/force-complete-working-status`. Commits:

| Commit     | Description                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------- |
| `ee5d844c` | feat: add chatroom_skills table to Convex schema                                             |
| `5852e23c` | feat: add skills.ts with built-in skill definitions, seedBuiltinSkills, list and get queries |
| `dac32e32` | feat: add activate mutation to skills.ts                                                     |
| `a999e43f` | feat: add CLI skill commands (list and activate)                                             |

### Usage

```bash
# List available skills
chatroom skill list --chatroom-id=<id> --role=<role>

# Activate a skill (creates a pending task with the skill's prompt)
chatroom skill activate backlog-score --chatroom-id=<id> --role=<role>
```

### Architecture

- **Schema**: `chatroom_skills` table with `by_chatroom` and `by_chatroom_skillId` indexes
- **Backend**: `services/backend/convex/skills.ts` — `list`, `get` queries + `activate` mutation
- **Seeding**: Built-in skills seeded lazily on first `activate` call (idempotent)
- **CLI**: `packages/cli/src/commands/skill/` — `listSkills` and `activateSkill` functions
- **Tests**: `services/backend/convex/skills.spec.ts` — 6 tests covering all query/mutation paths

## 9. Machine-installed (external) skills

`chatroom skill list` and `chatroom skill activate` also discover Agent Skills installed on the local machine, for example `~/.agents/skills/agent-browser/SKILL.md`. These skills are read by the CLI process from the local filesystem. They are never written to the backend.

Agents running under the Claude SDK do not load these skills natively, so `chatroom skill` is the only discovery path for them.

### Scanned roots

Roots are scanned in this order, relative to the home directory:

1. `.agents/skills`
2. `.config/agents/skills`
3. `.claude/skills`
4. `.codex/skills`
5. `.config/opencode/skills`
6. `.config/opencode/skill`
7. `.cursor/skills`
8. `.gemini/skills`
9. `.copilot/skills`
10. `.pi/agent/skills`

A missing root is skipped silently. Other read errors are reported as issues. A dangling `SKILL.md` symlink is reported as `unreadable` (`ENOENT`); a directory without `SKILL.md` is ignored silently.

### Discovery rules

- Depth is exactly one level: `<root>/<entry>/SKILL.md`. Nothing is recursed into.
- Dot-directories are skipped. Each root considers at most 200 entries, sorted by name. Extra entries are dropped with a `root-truncated` issue.
- Symlinked skill directories are followed. The realpath is used for de-duplication.
- Only `SKILL.md` is read. Its size is checked before reading. Files larger than 64 KiB are reported as `too-large` and are not read or truncated.
- No scripts or other files in the skill directory are executed or read.

### Precedence

1. **Builtins win.** An installed skill whose id matches a builtin is hidden and reported as `builtin-collision`.
2. **First root wins.** When two roots contain the same id at different realpaths, the later one is reported as `shadowed`.
3. **Same realpath is de-duplicated silently.** Only an accepted or shadowed entry claims a realpath, so a rejected alias (for example a symlink whose name doesn't match the frontmatter) never hides the real skill directory.

### Validation

`SKILL.md` must start with YAML frontmatter delimited by `---` lines.

| Field         | Rule                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `name`        | Required. Lowercase letters, digits, and single hyphens, at most 64 characters. Must equal the directory name. |
| `description` | Required. 1 to 1024 characters after trimming.                                                                 |

Other frontmatter keys, such as `hidden`, `allowed-tools`, `license`, `compatibility`, and `metadata`, are parsed and ignored. In particular, `hidden: true` does not hide a skill.

Invalid skills are not listed. They appear in the `Skipped installed skills:` section of `chatroom skill list`, with the path and reason.

### Listing

`chatroom skill list` prints builtins under `Available skills:`, installed skills under `Installed skills (this machine):` (with each skill directory), and skipped skills under `Skipped installed skills:`. Every external field is sanitized before printing, so ANSI sequences and control characters are stripped, and Unicode bidi controls (U+202A–U+202E, U+2066–U+2069) are stripped; U+2028/U+2029 become newlines, carriage returns become newlines, and zero-width space, word joiner, BOM and Unicode tag characters are stripped; soft hyphen, the Hangul fillers and invisible operators (U+2061–U+2064), and the variation selectors supplement (U+E0100–U+E01EF) are also stripped. Single-line fields (description, directory, skipped path and detail, the not-found id) are collapsed to one line so a multi-line value can't forge rows; the activation body keeps its newlines.

### Activation

`chatroom skill activate <name>` first checks the backend builtin registry. Builtin ids keep the existing backend path, which is unchanged.

For a non-builtin id that matches an installed skill, the CLI prints the skill directory and the body of `SKILL.md`. It makes no backend call. Relative references in the body resolve against the skill directory.

Installed-skill activations are local only. They are not persisted to `chatroom_skillActivations` and are not re-injected into an agent's context. After a context reset, run `chatroom skill activate <name>` again.
