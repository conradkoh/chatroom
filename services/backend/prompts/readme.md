# Prompts

Agent prompt generation system.

## Folder Structure

```
prompts/
├── types/              # Shared types
│   └── cli.ts          # CLI command generator types
├── cli/                # CLI command generators
│   ├── get-next-task/
│   │   └── command.ts  # Command generator
│   ├── handoff/
│   │   └── command.ts  # Command generator
│   └── notify-user/
│       └── command.ts  # Command generator
├── base/               # Base prompts (shared by all teams)
│   └── shared/         # Shared utilities
├── teams/              # Team-specific customizations
│   ├── duo/            # Duo team (planner + builder)
│   └── solo/           # Solo team
└── generator.ts        # Prompt generator
```

## Command Generators

Each CLI command has a `command.ts` file that generates command strings. This ensures:

- **Single source of truth** for command format
- **Type safety** via discriminated unions
- **No drift** between prompts and actual CLI

### Available Commands

| Command         | Generator                      | Description                             |
| --------------- | ------------------------------ | --------------------------------------- |
| `handoff`       | `cli/handoff/command.ts`       | Complete task and hand off to next role |
| `notify-user`   | `cli/notify-user/command.ts`   | Post an interim update to the user      |
| `get-next-task` | `cli/get-next-task/command.ts` | Wait for incoming tasks                 |

### Usage

```typescript
import { handoffCommand } from './cli/handoff/command.js';
import { getNextTaskCommand } from './cli/get-next-task/command.js';

// Examples with placeholders (for documentation)
handoffCommand({ cliEnvPrefix: '' });
// → "chatroom handoff --chatroom-id=\"<chatroom-id>\" --role=\"<role>\" --next-role=\"<target>\" << 'CHATROOM_HANDOFF_END' ..."

getNextTaskCommand({ cliEnvPrefix: '' });
// → "chatroom get-next-task --chatroom-id=\"<chatroom-id>\" --role=\"<role>\""

// Commands with real values (for actual prompts)
handoffCommand({
  chatroomId: 'abc123',
  role: 'builder',
  nextRole: 'planner',
  cliEnvPrefix: '',
});
// → "chatroom handoff --chatroom-id=\"abc123\" --role=\"builder\" --next-role=\"planner\" << 'CHATROOM_HANDOFF_END' ..."
```

## Guidelines

1. **All CLI commands in prompts must use command generators** - Never hardcode command strings
2. **Colocate command.ts with its command folder** - `cli/<command-name>/command.ts`
3. **Types go in prompts/types/** - Shared across all command generators
4. **Use command generators for actual prompts** - Uses real values from context
