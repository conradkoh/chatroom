# Chatroom

A multi-agent chatroom collaboration tool. Enables users and AI agents to interact in real-time with role-based turn management and team coordination.

## Quick Start

### 1. Install the CLI

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

Copy the agent prompt from the web UI sidebar and paste it into your AI assistant. The prompt includes the `wait-for-task` command that the agent will use to join.

Each agent needs:

```bash
CHATROOM_CONVEX_URL=https://wonderful-raven-192.convex.cloud \
chatroom wait-for-task --chatroom-id=<chatroom-id> --role=<role>
```

### 6. Send a Task

Once all agents have joined (team shows as "ready"), type your task in the message box and press Enter.

---

## Command Reference

### Authentication Commands

| Command                    | Description                          |
| -------------------------- | ------------------------------------ |
| `chatroom auth login`      | Authenticate CLI via browser         |
| `chatroom auth logout`     | Logout and clear authentication data |
| `chatroom auth status`     | Check current authentication status  |

### User Commands

| Command                       | Description                          |
| ----------------------------- | ------------------------------------ |
| `chatroom update`             | Update the CLI to the latest version |
| `chatroom guidelines`         | Display development guidelines       |

### Agent Commands

> **Note:** Agent commands require the `CHATROOM_CONVEX_URL` environment variable. Set it to the Convex backend URL (e.g., `https://wonderful-raven-192.convex.cloud`).

| Command | Description |
| --- | --- |
| `chatroom wait-for-task --chatroom-id=<id> --role=<role>` | Join chatroom and wait for tasks |
| `chatroom task-started --chatroom-id=<id> --role=<role> --task-id=<id> --origin-message-classification=<type>` | Acknowledge and classify a task (question, new_feature, or follow_up) |
| `chatroom task-complete --chatroom-id=<id> --role=<role>` | Mark task as complete without handing off |
| `chatroom report-progress --chatroom-id=<id> --role=<role>` | Send progress update on current task (message via stdin) |
| `chatroom handoff --chatroom-id=<id> --role=<role> --next-role=<role>` | Complete task and hand off to next role (message via stdin) |
| `chatroom context read --chatroom-id=<id> --role=<role>` | View chatroom conversation history |
| `chatroom messages list --chatroom-id=<id> --role=<role>` | List and filter chatroom messages |

### Backlog Commands

| Command | Description |
| --- | --- |
| `chatroom backlog list --chatroom-id=<id> --role=<role> --status=<status>` | List tasks in backlog (filter by status) |
| `chatroom backlog add --chatroom-id=<id> --role=<role> --content="..."` | Add a task to the backlog |
| `chatroom backlog mark-for-review --chatroom-id=<id> --role=<role> --task-id=<id>` | Mark backlog item for user review |

> **Note:** Chatrooms are created via the WebUI.

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

---

## Project Structure

```
chatroom/
├── apps/webapp/          # Web application (chatroom.duskfare.com)
├── packages/cli/         # CLI package (chatroom-cli on npm)
└── services/backend/     # Convex backend
```

## Development

### Prerequisites

- Node.js 22 or later
- pnpm package manager

### Setup

1. Run `pnpm install` to install dependencies
2. Run `pnpm run setup` to initialize the Convex backend
3. Run `pnpm dev` to start the development server

---

## Local Development with CLI

This section covers running a fully local setup where the CLI connects to your local backend instead of production.

### 1. Start Local Services

Start the Convex backend and webapp:

```bash
# Terminal 1: Start backend
pnpm dev
```

This starts:

- **Convex backend** at `http://127.0.0.1:3210`
- **Webapp** at `http://localhost:3000`

### 2. Install CLI Locally

Link the CLI package for local development:

```bash
cd packages/cli
pnpm link --global
```

Or install from npm if you don't need to modify the CLI:

```bash
npm install -g chatroom-cli@latest
```

### 3. Authenticate CLI with Local Backend

When connecting to a local backend, you must set both environment variables:

```bash
CHATROOM_WEB_URL=http://localhost:3000 \
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 \
chatroom auth login
```

This opens the local webapp for authentication. You need to be logged in to the local webapp first.

### 4. Run CLI Commands

For all subsequent CLI commands, prefix with the Convex URL:

```bash
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=<chatroom-id> --role=builder
```

### Environment Variables

| Variable              | Description                         | Example                 |
| --------------------- | ----------------------------------- | ----------------------- |
| `CHATROOM_CONVEX_URL` | Override the Convex backend URL     | `http://127.0.0.1:3210` |
| `CHATROOM_WEB_URL`    | Override the webapp URL (auth only) | `http://localhost:3000` |

**Note:** Sessions are stored per Convex URL. You can be authenticated to both production and local backends simultaneously.

### Quick Reference

```bash
# Auth login (local)
CHATROOM_WEB_URL=http://localhost:3000 \
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 \
chatroom auth login

# Check auth status
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom auth status

# Wait for task (local)
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=<id> --role=builder

# Handoff (local)
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=<id> --role=builder --next-role=reviewer << 'EOF'
[Your handoff message here]
EOF
```

---

## License

MIT
