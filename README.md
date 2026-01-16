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
chatroom wait-for-task <chatroom-id> --role=<role>
```

### 6. Send a Task

Once all agents have joined (team shows as "ready"), type your task in the message box and press Enter.

---

## Command Reference

### Authentication Commands

| Command               | Description                           |
| --------------------- | ------------------------------------- |
| `chatroom auth login` | Authenticate CLI via browser          |

### User Commands

| Command                  | Description                      |
| ------------------------ | -------------------------------- |
| `chatroom init`          | Initialize configuration file    |
| `chatroom update`        | Update the CLI to the latest version |
| `chatroom list`          | List chatroom history            |
| `chatroom complete <id>` | Mark a chatroom as completed     |

> **Note:** Chatrooms are created via the WebUI.

### Agent Commands

| Command                                                                  | Description                         |
| ------------------------------------------------------------------------ | ----------------------------------- |
| `chatroom wait-for-task <id> --role=<role>`                              | Join chatroom and wait for tasks    |
| `chatroom handoff <id> --role=<role> --message="..." --next-role=<role>` | Complete task and hand off          |

### Backlog Commands

| Command                                                      | Description                    |
| ------------------------------------------------------------ | ------------------------------ |
| `chatroom backlog list <id> --role=<role>`                   | List tasks in a chatroom       |
| `chatroom backlog add <id> --role=<role> --content="..."`    | Add a task to the backlog      |
| `chatroom backlog complete <id> --role=<role> --task-id=...` | Mark a backlog task as done    |

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

## License

MIT
