# Prompts

Agent prompt generation system.

## Folder Structure

```
prompts/
├── types/              # Shared types
│   └── cli.ts          # CLI command generator types
├── base/               # Base prompts (shared by all teams)
│   ├── cli/            # CLI command prompts
│   │   ├── task-started/
│   │   │   └── command.ts       # Command generator
│   │   ├── handoff/
│   │   │   └── command.ts       # Command generator
│   │   └── wait-for-task/
│   │       └── command.ts       # Command generator
│   ├── roles/          # Role definitions (builder, reviewer)
│   ├── workflows/      # Workflow definitions
│   └── shared/         # Shared utilities
├── teams/              # Team-specific customizations
│   └── pair/           # Pair team (builder + reviewer)
└── generator.ts        # Prompt generator
```

## Command Generators

Each CLI command has a `command.ts` file that generates command strings. This ensures:
- **Single source of truth** for command format
- **Type safety** via discriminated unions
- **No drift** between prompts and actual CLI

### Available Commands

| Command | Generator | Description |
|---------|-----------|-------------|
| `task-started` | `base/cli/task-started/command.ts` | Acknowledge and classify a task |
| `handoff` | `base/cli/handoff/command.ts` | Complete task and hand off to next role |
| `wait-for-task` | `base/cli/wait-for-task/command.ts` | Wait for incoming tasks |

### Usage

```typescript
import { taskStartedCommand } from './base/cli/task-started/command.js';
import { handoffCommand } from './base/cli/handoff/command.js';
import { waitForTaskCommand } from './base/cli/wait-for-task/command.js';

// Examples with placeholders (for documentation)
taskStartedCommand({ type: 'example' })
// → "chatroom task-started <chatroom-id> --role=<role> --task-id=<task-id> ..."

handoffCommand({ type: 'example' })
// → "chatroom handoff <chatroom-id> --role=<role> --message-file=<message-file> --next-role=<target>"

waitForTaskCommand({ type: 'example' })
// → "chatroom wait-for-task <chatroom-id> --role=<role>"

// Commands with real values (for actual prompts)
taskStartedCommand({ 
  type: 'command', 
  chatroomId: 'abc', 
  role: 'builder', 
  taskId: 'xyz', 
  classification: 'question' 
})
// → "chatroom task-started abc --role=builder --task-id=xyz --origin-message-classification=question"
```

## Discriminated Unions

Command params use discriminated unions with `type` field:

```typescript
// types/cli.ts

type TaskStartedParams =
  | { type: 'example'; classification?: MessageClassification }  // Placeholders
  | { type: 'command'; chatroomId: string; role: string; ... }   // Real values
```

## Guidelines

1. **All CLI commands in prompts must use command generators** - Never hardcode command strings
2. **Colocate command.ts with its command folder** - `cli/<command-name>/command.ts`
3. **Types go in prompts/types/** - Shared across all command generators
4. **Use `type: 'example'` for documentation** - Shows placeholders
5. **Use `type: 'command'` for actual prompts** - Uses real values from context
