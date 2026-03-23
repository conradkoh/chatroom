# Prompts

Agent prompt generation system.

## Folder Structure

```
prompts/
├── types/              # Shared types
│   └── cli.ts          # CLI command generator types
├── base/               # Base prompts (shared by all teams)
│   ├── cli/            # CLI command prompts
│   │   ├── classify/
│   │   │   └── command.ts       # Command generator
│   │   ├── handoff/
│   │   │   └── command.ts       # Command generator
│   │   └── get-next-task/
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

| Command         | Generator                           | Description                             |
| --------------- | ----------------------------------- | --------------------------------------- |
| `classify`      | `base/cli/classify/command.ts`      | Classify a task's origin message        |
| `handoff`       | `base/cli/handoff/command.ts`       | Complete task and hand off to next role |
| `get-next-task` | `base/cli/get-next-task/command.ts` | Wait for incoming tasks                 |

### Usage

```typescript
import { classifyCommand } from './base/cli/classify/command.js';
import { handoffCommand } from './base/cli/handoff/command.js';
import { getNextTaskCommand } from './base/cli/get-next-task/command.js';

// Examples with placeholders (for documentation)
classifyCommand({ cliEnvPrefix: '' });
// → "chatroom classify --chatroom-id=<chatroom-id> --role=<role> --task-id=<task-id> ..."

handoffCommand({ type: 'example' });
// → "chatroom handoff <chatroom-id> --role=<role> --message-file=<message-file> --next-role=<target>"

getNextTaskCommand({ type: 'example' });
// → "chatroom get-next-task <chatroom-id> --role=<role>"

// Commands with real values (for actual prompts)
classifyCommand({
  chatroomId: 'abc',
  role: 'builder',
  taskId: 'xyz',
  classification: 'question',
  cliEnvPrefix: '',
});
// → "chatroom classify --chatroom-id=abc --role=builder --task-id=xyz --origin-message-classification=question"
```

## Guidelines

1. **All CLI commands in prompts must use command generators** - Never hardcode command strings
2. **Colocate command.ts with its command folder** - `cli/<command-name>/command.ts`
3. **Types go in prompts/types/** - Shared across all command generators
4. **Use command generators for actual prompts** - Uses real values from context
