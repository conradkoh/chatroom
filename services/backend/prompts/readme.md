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
│   │   │   ├── command.ts       # Command generator
│   │   │   ├── main-prompt.ts   # Main prompt content
│   │   │   ├── classification/  # Classification-specific guidance
│   │   │   └── index.ts         # Exports
│   │   ├── handoff/
│   │   └── wait-for-task/
│   ├── roles/          # Role definitions (builder, reviewer)
│   ├── workflows/      # Workflow definitions
│   └── shared/         # Shared utilities
├── teams/              # Team-specific customizations
│   └── pair/           # Pair team (builder + reviewer)
└── generator.ts        # Prompt generator
```

## Key Concepts

### Command Generators

Each CLI command has a `command.ts` file that generates command strings. This ensures:
- **Single source of truth** for command format
- **Type safety** via discriminated unions
- **No drift** between prompts and actual CLI

```typescript
// prompts/base/cli/task-started/command.ts

import type { TaskStartedParams } from '../../../types/cli.js';

export function taskStartedCommand(params: TaskStartedParams): string {
  if (params.type === 'example') {
    return `chatroom task-started <chatroom-id> --role=<role> --task-id=<task-id> ...`;
  }
  // type === 'command' - use actual values
  return `chatroom task-started ${params.chatroomId} --role=${params.role} --task-id=${params.taskId} ...`;
}
```

### Discriminated Unions

Command params use discriminated unions with `type` field:

```typescript
// types/cli.ts

type TaskStartedParams =
  | { type: 'example'; classification?: MessageClassification }  // Placeholders
  | { type: 'command'; chatroomId: string; role: string; ... }   // Real values
```

### Usage

```typescript
import { taskStartedCommand } from './base/cli/task-started/command.js';

// Example with placeholders
taskStartedCommand({ type: 'example' })
// → "chatroom task-started <chatroom-id> --role=<role> --task-id=<task-id> ..."

// Command with real values
taskStartedCommand({ type: 'command', chatroomId: 'abc', role: 'builder', taskId: 'xyz', classification: 'question' })
// → "chatroom task-started abc --role=builder --task-id=xyz --origin-message-classification=question"
```

## Guidelines

1. **All CLI commands in prompts must use command generators** - Never hardcode command strings
2. **Colocate command.ts with its command folder** - `cli/<command-name>/command.ts`
3. **Types go in prompts/types/** - Shared across all command generators
4. **Use `type: 'example'` for documentation** - Shows placeholders
5. **Use `type: 'command'` for actual prompts** - Uses real values from context
