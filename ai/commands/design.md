# CLI Command Design Decisions

This document captures design decisions for the chatroom CLI commands.

## File-Only Content Input (v1.0.50+)

### Problem

The complexity of crafting bash commands with correct escape sequences is too hard for AI models, including advanced ones like GPT 5.2. When passing long-form content (like handoff messages, descriptions, or technical specifications), agents struggle with:

- Escaping quotes within quotes
- Handling newlines and special characters
- Multi-line markdown content
- Shell-specific escaping rules

### Solution

**Remove inline content options entirely. Only support file-based input.**

Instead of:
```bash
# Hard for AI models - escape sequences are complex
chatroom handoff <id> --role=builder --message="Complex \"quoted\" content with
newlines and $variables" --next-role=reviewer
```

Require:
```bash
# Easy for AI models - just write to a file with unique ID
mkdir -p tmp/chatroom
MSG_FILE="tmp/chatroom/message-$(date +%s%N).md"
echo "Complex content here" > "$MSG_FILE"
chatroom handoff <id> --role=builder --message-file="$MSG_FILE" --next-role=reviewer
```

### Affected Commands

| Command | Old Options | New Options |
|---------|-------------|-------------|
| `handoff` | `--message`, `--message-file` | `--message-file` only |
| `task-started` | `--description`, `--description-file` | `--description-file` only |
| `task-started` | `--tech-specs`, `--tech-specs-file` | `--tech-specs-file` only |
| `backlog add` | `--content`, `--content-file` | `--content-file` only |

### Design Principles

1. **File paths only** - All long-form content is passed via file paths
2. **No inline content** - Removes the option entirely to avoid confusion
3. **Simple file names** - Agents can use `/tmp/handoff.md`, `/tmp/description.md`, etc.
4. **No cleanup** - Agents manage file lifecycle (files can be reused or inspected for debugging)
5. **UTF-8 encoding** - All files are read as UTF-8 text

### Benefits

1. **Model accessibility** - Works with any AI model, regardless of escaping capabilities
2. **Simpler code** - No complex escaping logic needed
3. **Debuggable** - Files can be inspected to verify content
4. **Consistent** - All content follows the same pattern

### File Location

Files are written to `tmp/chatroom/` in the working directory. This location:
- Avoids system permission prompts that occur when writing to `/tmp/`
- Avoids "dot file protection" that some systems have for dotfiles/dotfolders

```bash
# Always create the directory first
mkdir -p tmp/chatroom
```

### Unique File IDs

To prevent conflicts when multiple agents write files simultaneously, file names
include a unique timestamp-based ID using `$(date +%s%N)`:

```bash
# Generate a unique file name
MSG_FILE="tmp/chatroom/message-$(date +%s%N).md"
echo "Content here" > "$MSG_FILE"
chatroom handoff <id> --message-file="$MSG_FILE" --next-role=...
```

The `%s%N` format produces a nanosecond-precision timestamp (e.g., `1737514800123456789`),
making collisions extremely unlikely even with parallel execution.

### File Naming Convention

Agents should use these patterns with unique IDs in `tmp/chatroom/`:

```bash
tmp/chatroom/message-<unique-id>.md      # For handoff messages
tmp/chatroom/description-<unique-id>.md  # For feature descriptions
tmp/chatroom/tech-specs-<unique-id>.md   # For technical specifications
tmp/chatroom/task-<unique-id>.md         # For backlog task content
tmp/chatroom/feedback-<unique-id>.md     # For review feedback
tmp/chatroom/approval-<unique-id>.md     # For approval messages
```

**Note:** The `tmp/` directory should be added to `.gitignore` to avoid committing temporary files.

### Implementation Date

- v1.0.50: File-only content input (January 2026)
- v1.0.51: Changed from `/tmp/` to `.chatroom/tmp/handoff/` (January 2026)
- v1.0.52: Added unique ID suffix to prevent file conflicts (January 2026)
- v1.0.53: Centralized config with helper functions (January 2026)
- v1.0.54: Changed to `tmp/chatroom/` to avoid dot file protection (January 2026)

### Migration

This is a breaking change. Agents using the old inline options will receive an error message indicating the option is not recognized.
