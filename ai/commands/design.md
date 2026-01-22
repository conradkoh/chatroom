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
# Easy for AI models - just write to a file
echo "Complex content here" > /tmp/handoff.md
chatroom handoff <id> --role=builder --message-file=/tmp/handoff.md --next-role=reviewer
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

### File Naming Convention

Agents should use predictable file names in `/tmp/`:

```bash
/tmp/handoff.md          # For handoff messages
/tmp/description.md      # For feature descriptions
/tmp/tech-specs.md       # For technical specifications
/tmp/content.md          # For backlog task content
/tmp/feedback.md         # For review feedback
/tmp/approval.md         # For approval messages
```

### Implementation Date

Implemented in CLI version 1.0.50 (January 2026).

### Migration

This is a breaking change. Agents using the old inline options will receive an error message indicating the option is not recognized.
