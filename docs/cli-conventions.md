# CLI Command Development Guidelines

This document outlines the conventions and patterns for developing CLI commands in the chatroom project.

## Command Structure

### File Organization

- Command implementations go in `packages/cli/src/commands/`
- Each command gets its own file (e.g., `artifact.ts`, `handoff.ts`)
- Commands are registered in `packages/cli/src/index.ts`

### Command Registration Pattern

```typescript
const commandGroup = program
  .command("group-name")
  .description("Group description");

commandGroup
  .command("subcommand <requiredArg>")
  .description("Subcommand description")
  .requiredOption("--role <role>", "Your role")
  .option("--optional <value>", "Optional option")
  .action(async (requiredArg, options) => {
    await maybeRequireAuth();
    const { commandFunction } = await import("./commands/command-file.js");
    await commandFunction(requiredArg, options);
  });
```

## Option Ordering Convention

Order options in this sequence for consistency:

1. **Identity Options** (`--role`, `--session`)
2. **Primary Action Options** (`--classification`, `--next-role`)
3. **File Input Options** (`--message-file`, `--from-file`, `--description-file`)
4. **Multi-Value Options** (`--attach-artifact`, `--artifact`)
5. **Optional Metadata** (`--description`, `--title`)

### Example

```typescript
.option('--role <role>', 'Your role')                                    // Identity
.option('--classification <type>', 'Message classification')               // Primary action
.option('--message-file <path>', 'Path to message file')                 // File input
.option('--attach-artifact <id>', 'Artifact to attach', collect, [])      // Multi-value
.option('--description <text>', 'Optional description')                   // Metadata
```

## Multi-Value Patterns

### Use Repeated Flags

For options that can accept multiple values, use repeated flags:

```typescript
.option('--artifact <id>', 'Artifact ID (can be used multiple times)', collect, [])
```

### Usage Examples

```bash
# Correct
chatroom artifact view-many <id> --artifact=id1 --artifact=id2 --artifact=id3
chatroom handoff <id> --attach-artifact=id1 --attach-artifact=id2

# Avoid positional arguments for multi-values
# Incorrect: chatroom artifact view-many <id> id1 id2 id3
```

### Implementation

```typescript
// In command definition
.option('--artifact <id>', 'Artifact ID (can be used multiple times)', (value: string, previous: string[]) => {
  return previous ? [...previous, value] : [value];
}, [])

// In handler
const artifactIds = options.artifact || [];
```

## Error Formatting

### Use the Error Formatting Utility

Import and use the error formatting functions from `utils/error-formatting.ts`:

```typescript
import {
  formatError,
  formatValidationError,
  formatAuthError,
  formatChatroomIdError,
} from "../utils/error-formatting.js";
```

### Error Message Patterns

#### Basic Error

```typescript
formatError("Error message", [
  "Optional suggestion 1",
  "Optional suggestion 2",
]);
```

#### Validation Error

```typescript
formatValidationError("field name", actualValue, expectedValue);
```

#### Authentication Error

```typescript
formatAuthError(currentUrl, otherUrls);
```

#### Chatroom ID Error

```typescript
formatChatroomIdError(chatroomId);
```

### Output Format

```
❌ Error message
💡 Suggestion 1
💡 Suggestion 2
```

## Authentication Pattern

All commands that require authentication should follow this pattern:

```typescript
// Get session ID for authentication
const sessionId = getSessionId();
if (!sessionId) {
  formatAuthError();
  process.exit(1);
}

// Use sessionId in API calls
const result = await client.query(api.some.function, {
  sessionId,
  ...otherArgs,
});
```

## Chatroom ID Validation

Validate chatroom IDs consistently:

```typescript
// Validate chatroom ID format
if (
  !chatroomId ||
  typeof chatroomId !== "string" ||
  chatroomId.length < 20 ||
  chatroomId.length > 40
) {
  formatChatroomIdError(chatroomId);
  process.exit(1);
}
```

## File Input Pattern

For commands that read files:

```typescript
// Read file content
let content: string;
try {
  content = readFileContent(options.fromFile, "--from-file");
} catch (err) {
  formatFileError(
    "read for --from-file",
    options.fromFile,
    (err as Error).message,
  );
  process.exit(1);
}

// Validate content is not empty
if (!content || content.trim().length === 0) {
  formatError("File is empty");
  process.exit(1);
}
```

## Help Text Style

### Description Format

- Use present tense: "Create artifact" not "Creates artifact"
- Be concise but informative
- Include examples when helpful

### Required Options

Mark required options clearly in descriptions:

```typescript
.requiredOption('--role <role>', 'Your role (e.g., builder, reviewer)')
```

### Optional Options

Show optional options in brackets or indicate they're optional:

```typescript
.option('--description <text>', 'Optional description of the artifact')
```

## Type Safety

### Import Types

```typescript
import { api } from "../api.js";
import type { Id } from "../api.js";
```

### Type Casting

Cast IDs when needed:

```typescript
chatroomId: chatroomId as Id<"chatroom_rooms">;
artifactId: artifactId as Id<"chatroom_artifacts">;
```

## Testing Guidelines

### Build Verification

Always ensure the CLI builds successfully:

```bash
pnpm --filter chatroom-cli build
```

### Command Help

Test help text:

```bash
chatroom <command> --help
chatroom <command-group> --help
```

### Error Scenarios

Test error cases:

- Invalid chatroom IDs
- Missing files
- Authentication failures
- Invalid option combinations

## Common Patterns

### Command Function Signature

```typescript
export async function commandName(
  requiredArg: string,
  options: {
    role: string;
    optionalArg?: string;
    // ... other options
  },
): Promise<void> {
  // Implementation
}
```

### Client Usage

```typescript
const client = await getConvexClient();
const result = await client.mutation(api.some.function, args);
```

## Breaking Changes

When making breaking changes:

1. Update this documentation
2. Add migration notes to release notes
3. Consider backward compatibility
4. Test thoroughly

## Examples

### Complete Command Example

```typescript
// packages/cli/src/commands/example.ts
import { api } from "../api.js";
import type { Id } from "../api.js";
import { getSessionId } from "../infrastructure/auth/storage.js";
import { getConvexClient } from "../infrastructure/convex/client.js";
import {
  formatError,
  formatAuthError,
  formatChatroomIdError,
} from "../utils/error-formatting.js";

export async function exampleCommand(
  chatroomId: string,
  options: {
    role: string;
    message: string;
  },
) {
  // Authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    formatAuthError();
    process.exit(1);
  }

  // Validation
  if (
    !chatroomId ||
    typeof chatroomId !== "string" ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    formatChatroomIdError(chatroomId);
    process.exit(1);
  }

  // Implementation
  const client = await getConvexClient();
  try {
    const result = await client.mutation(api.some.function, {
      sessionId,
      chatroomId: chatroomId as Id<"chatroom_rooms">,
      message: options.message,
    });

    console.log("✅ Success");
  } catch (error) {
    formatError("Failed to execute command", [String(error)]);
    process.exit(1);
  }
}
```

Following these guidelines ensures consistency across all CLI commands and provides a better user experience.
