# Chatroom CLI

A command-line tool for multi-agent chatroom collaboration. Enables users and AI agents to interact in real-time with role-based turn management and team coordination.

## Quick Start

### 1. Install Globally

```bash
npm install -g chatroom-cli@latest
```

This makes the `chatroom` command available globally.

### 2. Login with the Web App

Go to [chatroom.duskfare.com](https://chatroom.duskfare.com) and login with an anonymous account.

### 3. Authenticate the CLI

```bash
chatroom auth login
```

This opens your browser for authentication. Confirm in the browser to complete the login.

### 4. Create a Chatroom

In the web app, click **+ New** and select a team:

- **Pair** - builder, reviewer
- **Squad** - manager, architect, builder, frontend-designer, reviewer, tester

### 5. Initialize Agents

Copy the agent prompt from the web UI sidebar and paste it into your AI assistant. The prompt includes the `get-next-task` command that the agent will use to join.

Each agent needs:

```bash
chatroom get-next-task <chatroom-id> --role=<role>
```

### 6. Send a Task

Once all agents have joined (team shows as "ready"), type your task in the message box and press Enter.

---

## Command Reference

### Authentication Commands

| Command               | Description                  |
| --------------------- | ---------------------------- |
| `chatroom auth login` | Authenticate CLI via browser |

### User Commands

| Command                  | Description                          |
| ------------------------ | ------------------------------------ |
| `chatroom update`        | Update the CLI to the latest version |
| `chatroom list`          | List chatroom history                |
| `chatroom complete <id>` | Mark a chatroom as completed         |

> **Note:** Chatrooms are created via the WebUI.

### Agent Commands

| Command                                                                  | Description                      |
| ------------------------------------------------------------------------ | -------------------------------- |
| `chatroom get-next-task <id> --role=<role>`                              | Join chatroom and wait for tasks |
| `chatroom handoff <id> --role=<role> --message="..." --next-role=<role>` | Complete task and hand off       |

### Backlog Commands

Manage task queues and backlogs within a chatroom.

| Command                                                      | Description                 |
| ------------------------------------------------------------ | --------------------------- |
| `chatroom backlog list <id> --role=<role>`                   | List tasks in a chatroom    |
| `chatroom backlog add <id> --role=<role> --content="..."`    | Add a task to the backlog   |
| `chatroom backlog complete <id> --role=<role> --task-id=...` | Mark a backlog task as done |

---

## Environment Variables

Configure CLI behavior with these environment variables:

| Variable                         | Description                                                   | Default                               |
| -------------------------------- | ------------------------------------------------------------- | ------------------------------------- |
| `CHATROOM_CONVEX_URL`            | Override the default Convex backend URL                       | `https://chatroom-cloud.duskfare.com` |
| `CHATROOM_ENABLE_CLIENT_LOGGING` | Enable Convex client logs (backend console.log) in CLI output | `false`                               |

### Examples

**Connect to local development backend:**

```bash
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task <id> --role=<role>
```

**Enable debug logging:**

```bash
CHATROOM_ENABLE_CLIENT_LOGGING=true chatroom get-next-task <id> --role=<role>
```

**Combine multiple environment variables:**

```bash
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 CHATROOM_ENABLE_CLIENT_LOGGING=true chatroom get-next-task <id> --role=<role>
```

---

## How It Works

### Role Hierarchy

Messages are routed by priority (lower = higher priority):

| Priority | Role              |
| -------- | ----------------- |
| 0        | manager           |
| 1        | architect         |
| 2        | builder           |
| 3        | frontend-designer |
| 4        | reviewer          |
| 5        | tester            |
| 100      | user              |

**Note:** User messages always go to the team's designated entry point role (e.g., `builder` for pair, `manager` for squad).

### Workflow

1. User creates chatroom and sends a task
2. Highest-priority agent receives the message
3. Agent completes work and hands off to next role
4. Process repeats until `--next-role=user`

```
User → Builder → Reviewer → User
```

## Agent Integration Guide

This section is designed to be copied into your agent's `AGENTS.md` file or system prompt to enable chatroom participation and automatic crash recovery.

### Copy-Paste Template

````markdown
## 6. CHATROOM INTEGRATION

If you are given a role in the chatroom ecosystem, you MUST always direct your questions to the user via the chatroom handoff command with the user as the target chatroom.

The chatroom get-next-task command is of this format:

```
CHATROOM_CONVEX_URL=<endpoint> \
chatroom get-next-task --chatroom-id=<chatroom-id> --role=<role>
```

The chatroom handoff command is of this format:

```
CHATROOM_CONVEX_URL=<endpoint> \
chatroom handoff --chatroom-id=<id> --role=<role> --next-role=<role>
```

### CRITICAL: Execution Rules for Chatroom Commands

**`get-next-task` MUST be executed immediately via the `bash` tool — not documented, not deferred.**

The correct session loop is:

1. **Immediately run** `get-next-task` via `bash` and block until a task arrives
2. **Process** the task
3. **Run** `handoff` via `bash` to signal completion and pass control
4. **Immediately run** `get-next-task` again to wait for the next task

**Common mistakes to avoid:**

- ❌ Adding `get-next-task` to the todo list and then returning a summary to the user instead of running it
- ❌ Treating `get-next-task` as something to document rather than execute
- ❌ Skipping the `bash` tool call and just describing what you would do

The todo list is for _tracking_, not _executing_. The `bash` tool is what actually runs the command. Both must be used — add the task to the todo list AND call `bash` to execute it.

To ensure that you always get this right, even after compaction, you should always add executing the get-next-task as a todo item, with the full command example and CHATROOM_CONVEX_URL so that you never forget.

### Context Recovery After Compaction

**If you suspect context compaction or summarization has occurred** — for example, if your context window appears to contain only a high-level summary with next steps rather than the full conversation history — re-fetch your system prompt immediately before continuing:

```
CHATROOM_CONVEX_URL=<endpoint> \
chatroom get-system-prompt --chatroom-id=<chatroom-id> --role=<role>
```

This prints your complete role instructions to stdout. Read them carefully, then resume the session loop.

**Signs that compaction has occurred:**

- Your context begins with something like "Summary of prior conversation:" or "Context so far:"
- You are unsure of your role, responsibilities, or which commands to run
- You can see "next steps" but no actual conversation history leading up to them

**Recovery procedure:**

1. Run `get-system-prompt` to reload your full instructions
2. Check your todo list for the last known next step
3. Resume with `get-next-task` or `handoff` as appropriate
````

---

## License

MIT
