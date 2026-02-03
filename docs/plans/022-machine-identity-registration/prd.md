# 022 - Machine Identity Registration: PRD

## Glossary

| Term | Definition |
|------|------------|
| **Machine** | A physical or virtual computer where the chatroom CLI is installed and agents can run |
| **Machine ID** | A UUID generated once per machine, stored in `~/.chatroom/machine.json` |
| **Agent Tool** | An AI coding assistant CLI (opencode, claude, or cursor) that can be spawned to work on tasks |
| **Daemon** | A long-running background process that listens for remote commands from the backend |
| **Agent Config** | Per-chatroom, per-role configuration storing the working directory and agent type used |
| **Available Tools** | The set of agent tools detected as installed on a machine (present in PATH) |
| **Remote Command** | A command sent from the web UI to a machine's daemon via the backend |
| **PID File** | A file storing the process ID of the running daemon, used to prevent multiple instances |

## User Stories

### Machine Registration

**US-1**: As a developer, I want my machine to be automatically registered when I run `wait-for-task`, so that the system knows about my machine without manual setup.

**US-2**: As a developer, I want my machine's available agent tools to be detected and reported to the backend, so that the web UI only shows start buttons for tools I have installed.

**US-3**: As a developer, I want the chatroom+role context (working directory, agent type) to be saved when I start an agent, so that remote restarts use the same configuration.

### Daemon Management

**US-4**: As a developer, I want to start a daemon process with `chatroom machine daemon start`, so that my machine can receive remote commands.

**US-5**: As a developer, I want the daemon to prevent multiple instances using a PID file, so that I don't accidentally run duplicate daemons.

**US-6**: As a developer, I want to check daemon status with `chatroom machine daemon status`, so that I know if my machine is ready to receive commands.

**US-7**: As a developer, I want to stop the daemon with `chatroom machine daemon stop`, so that I can cleanly shut down remote command capability.

### Remote Agent Start

**US-8**: As a developer, I want to start an agent remotely through the web UI, so that I can restart disconnected agents without accessing the terminal.

**US-9**: As a developer, I want remote start commands to only be allowed for my own machines, so that other users cannot execute commands on my machine.

**US-10**: As a developer, I want the server to determine which command to execute (not the client), so that malicious commands cannot be injected.

### Security

**US-11**: As a developer, I want machine registration to be tied to my authenticated session, so that machines are securely associated with my user account.

**US-12**: As a developer, I want remote commands to be validated against my session, so that only I can send commands to my machines.
