# Plan 006: Features System - PRD

## Glossary

| Term | Definition |
|------|------------|
| Feature | A user message classified as `new_feature` with title, description, and tech specs |
| Feature List | Command showing recent features in a chatroom |
| Feature Inspect | Command showing full details of a specific feature |
| Classification | Type of task: `question`, `new_feature`, or `follow_up` |
| Tech Specs | Technical specifications outlining the feature implementation approach |

## User Stories

### US-1: Agent lists recent features

**As** an agent receiving a question about past work,
**I want** to list recent features in the chatroom,
**So that** I can find relevant context from previous feature implementations.

**Acceptance Criteria:**
- `chatroom feature list <chatroomId> --role=<role>` shows recent features
- Output includes: title, description (truncated), message ID, date
- Most recent features first

### US-2: Agent inspects a specific feature

**As** an agent,
**I want** to inspect a specific feature by message ID,
**So that** I can see full details including technical specifications.

**Acceptance Criteria:**
- `chatroom feature inspect <chatroomId> <messageId> --role=<role>` shows full details
- Output includes: title, description, technical specifications, conversation thread

### US-3: Agent provides feature metadata on new_feature

**As** an agent starting a `new_feature` task,
**I want** to be required to provide structured metadata,
**So that** the feature is well-documented from the start.

**Acceptance Criteria:**
- CLI `task-started --classification=new_feature` requires: --title, --description, --tech-specs
- CLI fails with helpful error if fields are missing
- Backend accepts these as optional (backward compatibility)

### US-4: Agent sees classification-specific commands

**As** an agent receiving a task,
**I want** to see command examples with required fields for my classification,
**So that** I know exactly what to run.

**Acceptance Criteria:**
- Wait-for-task output includes `classificationCommands` in instructions
- Each classification shows its specific command format with required fields
- new_feature shows: `chatroom task-started ... --title="..." --description="..." --tech-specs="..."`

### US-5: Features are queryable for context

**As** an agent answering a question,
**I want** context commands suggested for question classification,
**So that** I can gather context before answering.

**Acceptance Criteria:**
- When classification is `question`, contextCommands includes feature list command
- Agent can optionally run commands to gather context
