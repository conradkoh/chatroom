# PRD: Task Delivery Prompt Refactor

## Glossary

| Term | Definition |
|------|------------|
| Task Delivery Prompt | The complete prompt shown to an agent when they receive a task via wait-for-task |
| Prompt Section | An individual part of the task delivery prompt (e.g., MESSAGE RECEIVED, CHATROOM STATE) |
| Section Registry | A collection of all available prompt sections with their rendering conditions |
| Task Receipt Context | The data context containing all information needed to render prompt sections |

## User Stories

### Agent Operator

1. **As an agent operator**, I want the wait-for-task output to contain all relevant guidance for my role, so that I can complete tasks effectively.

2. **As an agent operator**, I want role-specific sections (like Backlog Commands for builders) to appear only when relevant, so that the prompt is focused and not cluttered.

3. **As an agent operator**, I want the JSON output to be consistent and reliable, so that I can programmatically parse task information.

### Developer

1. **As a developer**, I want prompt sections to be defined in one place (backend), so that I don't have to modify multiple files to add new guidance.

2. **As a developer**, I want a composable section system, so that I can easily add role-specific sections without complex conditional logic.

3. **As a developer**, I want the CLI to be a thin rendering layer, so that prompt changes don't require CLI updates or npm publishes.

4. **As a developer**, I want the migration to be gradual, so that I can verify each change doesn't break functionality.
