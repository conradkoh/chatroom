# Product Requirements: API Naming Cleanup

## Glossary

| Term | Definition |
|------|------------|
| **sendMessage** | New method name for sending a message to a chatroom (without completing task) |
| **completeAndHandoff** | New method name for completing current work and handing off to next agent |
| **Deprecated** | Marked for removal in a future version; still works but shows warning |
| **Handoff** | The act of passing control from one agent to another |

## User Stories

### As a developer using the CLI

1. **I want command names that clearly describe what they do** so that I can understand the CLI without reading extensive documentation.

   - Given I run `chatroom --help`
   - When I see the command list
   - Then `send-message` and `handoff` clearly indicate their purpose

2. **I want to be notified when using deprecated commands** so that I can update my scripts before they break.

   - Given I use `chatroom send` (deprecated)
   - When the command runs
   - Then I see a deprecation notice suggesting `chatroom send-message`

3. **I want old commands to still work** so that my existing scripts don't immediately break.

   - Given I have scripts using `chatroom task-complete`
   - When I run them after the update
   - Then they still work (with deprecation notice)

### As a developer using the backend API

1. **I want method names that are self-documenting** so that I can understand the API from autocomplete alone.

   - Given I type `api.messages.`
   - When I see autocomplete suggestions
   - Then `sendMessage` and `completeAndHandoff` clearly indicate their purpose

2. **I want deprecated methods to remain available** so that my existing code continues to work.

   - Given I have code calling `api.messages.send`
   - When I run my application after the update
   - Then it still works (types may show deprecation warning)

### As a maintainer

1. **I want a clear path to remove deprecated code** so that I can clean up the codebase in a future version.

   - Given deprecated methods/commands exist
   - When I look at `cleanup.md`
   - Then I see a clear list of what to remove and when

## Acceptance Criteria

### CLI Commands

| Criteria | Verification |
|----------|--------------|
| `chatroom send-message` sends messages | Run command, verify message appears |
| `chatroom handoff` completes tasks and hands off | Run command, verify task completion and handoff |
| `chatroom send` still works | Run command, verify same behavior as `send-message` |
| `chatroom task-complete` still works | Run command, verify same behavior as `handoff` |
| Deprecation notices in help | Run `chatroom --help`, see notices |

### Backend Methods

| Criteria | Verification |
|----------|--------------|
| `sendMessage` works | Call mutation, verify message created |
| `completeAndHandoff` works | Call mutation, verify task completed and handoff sent |
| `send` still works | Call mutation, verify same behavior |
| `sendHandoff` still works | Call mutation, verify same behavior |
| JSDoc deprecation notes | Check TypeScript hover text shows deprecation |
