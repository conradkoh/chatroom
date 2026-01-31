# Machine Authentication - PRD

## Glossary

| Term | Definition |
|------|------------|
| **Machine** | A registered computing device (laptop, server, etc.) that can receive and execute commands from the chatroom system |
| **Machine Owner** | The user who registered the machine and has exclusive control over it |
| **Machine Registration** | The process of associating a machine with a user account |
| **Machine Token** | A secure credential issued during registration that authenticates the machine |
| **Command** | A pre-defined, backend-controlled instruction that can be sent to a registered machine |
| **Whitelisted Command** | A command that has been explicitly approved for execution by the backend |
| **Machine Session** | An active connection from a machine running `chatroom machine start` |

## User Stories

### Machine Registration

**US-1**: As a user, I want to register my machine so that I can receive commands from the chatroom UI.
- **Acceptance Criteria**:
  - Running `chatroom machine register` displays existing registered machines
  - If the current machine is not registered, prompts to register it
  - Registration creates a unique machine identifier linked to my account

**US-2**: As a user, I want to see my registered machines in the UI so that I can manage them.
- **Acceptance Criteria**:
  - The UI displays a list of my registered machines
  - Each machine shows its registration date and last active time
  - I can identify which machine is which (via name or identifier)

### Command Execution

**US-3**: As a user, I want my machine to listen for commands when I run `chatroom machine start` so that I can receive UI-triggered actions.
- **Acceptance Criteria**:
  - `chatroom machine start` establishes a persistent connection to the backend
  - The connection uses WebSocket/subscription for real-time command delivery
  - The CLI shows connection status and waits for commands

**US-4**: As a user, I want to send a test command to my machine from the UI so that I can verify the connection works.
- **Acceptance Criteria**:
  - Clicking on a registered machine in the UI shows a "Send test command" button
  - Pressing the button triggers a command that appears in the CLI output
  - Only I (the machine owner) can send commands to my machines

### Security

**US-5**: As a system administrator, I want commands to be whitelisted on the backend so that users cannot inject arbitrary commands.
- **Acceptance Criteria**:
  - The backend maintains a list of allowed command types
  - The UI only presents command options from this whitelist
  - Any attempt to send an unlisted command is rejected
  - User input is sanitized to prevent injection attacks

**US-6**: As a machine owner, I want only my account to be able to send commands to my machines so that others cannot control my devices.
- **Acceptance Criteria**:
  - All `machine.command.*` endpoints verify the caller is the machine owner
  - Unauthorized command attempts return an access denied error
  - No other user can see or interact with my machines
