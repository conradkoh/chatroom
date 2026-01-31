# CLI Input Encoding Specification

## Goals

1. **No escape characters required** - Content should be written as-is without escaping
2. **Multiple parameters support** - Support commands that need multiple text inputs
3. **Delimiter collision handling** - Handle cases where content contains the delimiter
4. **Agent-friendly** - Simple for LLM agents to generate correctly
5. **Human-readable** - Easy to read and debug

## Encoding Format

### Single Parameter (Simple)

For commands with only one text parameter (e.g., `handoff --message`):

```bash
chatroom handoff <chatroomId> --role=<role> --next-role=<target> << 'EOF'
Content goes here
Can span multiple lines
No escaping needed
EOF
```

**Decoding**: Read entire stdin as single parameter.

### Multiple Parameters (Structured)

For commands with multiple text parameters (e.g., `task-started` with title, description, techSpecs):

```bash
chatroom task-started <chatroomId> --role=<role> --task-id=<id> --classification=new_feature << 'PARAMS_END'
---TITLE---
User Authentication System
---DESCRIPTION---
Add complete user authentication with login/logout and JWT tokens.

This is a multi-line description that can contain anything.
---TECH_SPECS---
- Use bcrypt for password hashing
- JWT tokens with 24h expiry
- Store refresh tokens in DB
PARAMS_END
```

**Structure**:
- Each parameter starts with `---PARAM_NAME---` on its own line
- Parameter content follows until the next delimiter or end of input
- Parameter names must be UPPERCASE with underscores
- Leading/trailing whitespace in content is preserved (important for markdown)

**Decoding**:
1. Split input by lines
2. Look for lines matching pattern: `^---[A-Z_]+---$`
3. Content between delimiters belongs to that parameter
4. Trim leading/trailing newlines from each parameter value (but preserve internal formatting)

## Delimiter Collision Handling

**Problem**: What if content contains `---TITLE---`?

**Solution**: Use a **delimiter validation phase**

### Algorithm

1. **Before prompting the agent**, scan the expected parameter names
2. **Check if content might contain delimiters**:
   - If command uses structured format, the CLI must validate delimiters are unique
3. **If collision detected**, use a **prefixed delimiter format**:

```bash
chatroom task-started ... << 'PARAMS_END'
---(UUID:a1b2c3d4)TITLE---
Content here that might contain ---TITLE---
---(UUID:a1b2c3d4)DESCRIPTION---
More content
PARAMS_END
```

The UUID prefix makes collisions astronomically unlikely.

### Collision Detection Strategy

**Practical approach**: 
- For 99.9% of cases, simple `---PARAM_NAME---` is sufficient
- The content is unlikely to contain the exact delimiter pattern on its own line
- **Only use UUID prefix if**:
  1. We detect collision in actual content (validation error), OR
  2. Command explicitly requests it (future feature)

**Implementation decision**:
- **Phase 1** (current): Only support simple delimiters `---PARAM_NAME---`
  - If content contains delimiter, it will cause parse error
  - Error message: "Content contains delimiter '---TITLE---'. Please remove or rephrase."
- **Phase 2** (future): Add UUID-prefix support when collision is detected

## Parameter Names

### Reserved Parameter Names

Standard parameter names that map to CLI options:

- `MESSAGE` - Handoff message content
- `TITLE` - Feature title
- `DESCRIPTION` - Feature description  
- `TECH_SPECS` - Technical specifications
- `FEEDBACK` - Review feedback
- `SUMMARY` - General summary content

### Custom Parameters

Future commands can define their own parameter names following the pattern:
- UPPERCASE letters
- Underscores for word separation
- No special characters

## Examples

### Example 1: Simple Handoff

```bash
chatroom handoff j123abc456def --role=builder --next-role=user << 'EOF'
## Summary
Implemented user authentication

## Changes Made
- Added login endpoint
- Added JWT token generation
- Added password hashing with bcrypt

## Testing
- All tests passing
- Manually verified login flow
EOF
```

**Decoded to**:
```typescript
{
  message: "## Summary\nImplemented user authentication\n\n## Changes Made\n- Added login endpoint\n- Added JWT token generation\n- Added password hashing with bcrypt\n\n## Testing\n- All tests passing\n- Manually verified login flow"
}
```

### Example 2: Task Started with Multiple Parameters

```bash
chatroom task-started j123abc456def --role=builder --task-id=k789xyz --classification=new_feature << 'PARAMS_END'
---TITLE---
User Authentication System
---DESCRIPTION---
Add complete authentication flow with JWT tokens.

Users should be able to:
- Register new accounts
- Login with email/password
- Logout and invalidate tokens
---TECH_SPECS---
- Use bcrypt for password hashing (min 10 rounds)
- JWT tokens with 24h expiry
- Refresh tokens stored in database
- Rate limiting on auth endpoints (10 req/min)
PARAMS_END
```

**Decoded to**:
```typescript
{
  title: "User Authentication System",
  description: "Add complete authentication flow with JWT tokens.\n\nUsers should be able to:\n- Register new accounts\n- Login with email/password\n- Logout and invalidate tokens",
  techSpecs: "- Use bcrypt for password hashing (min 10 rounds)\n- JWT tokens with 24h expiry\n- Refresh tokens stored in database\n- Rate limiting on auth endpoints (10 req/min)"
}
```

### Example 3: Content with Delimiter-Like Pattern (Edge Case)

```bash
chatroom handoff j123abc456def --role=builder --next-role=user << 'EOF'
## Summary
Fixed markdown rendering

## Details
The code was incorrectly parsing sections like:
---HEADER---
This should be treated as content, not a delimiter.

Fixed by escaping in the parser.
EOF
```

**Decoded to**:
```typescript
{
  message: "## Summary\nFixed markdown rendering\n\n## Details\nThe code was incorrectly parsing sections like:\n---HEADER---\nThis should be treated as content, not a delimiter.\n\nFixed by escaping in the parser."
}
```

**Note**: This works because:
1. Single-parameter mode doesn't use structured delimiters
2. Content is read as-is

**Edge case collision** (in multi-parameter mode):
```bash
# This WILL cause a parse error because TITLE appears in content
chatroom task-started ... << 'PARAMS_END'
---TITLE---
Fix delimiter handling
---DESCRIPTION---
The old code had this pattern:
---TITLE---
Which caused issues.
PARAMS_END
```

**Error message**:
```
❌ Parse error: Found unexpected delimiter '---TITLE---' at line 5.
Content appears to contain the delimiter pattern.

Workaround: Rephrase the content to avoid '---TITLE---' on its own line.
```

## Implementation Notes

### Parser Requirements

1. **Strict delimiter matching**:
   - Delimiter must be on its own line
   - Pattern: `^---[A-Z_]+---$` (start of line, delimiter, end of line)
   - Whitespace before/after delimiter line is not part of the delimiter

2. **Content preservation**:
   - Preserve all whitespace within content
   - Preserve empty lines within content
   - Trim only leading/trailing newlines from final parameter value

3. **Error handling**:
   - Unknown parameter names → error
   - Missing required parameters → error
   - Duplicate parameter names → error (use last occurrence)
   - Content contains delimiter (multi-param mode) → error with helpful message

### Future Enhancements

1. **UUID-prefixed delimiters** (Phase 2):
   - Generate UUID per command invocation
   - Use format: `---(UUID:xxxxx)PARAM_NAME---`
   - Only enabled when collision detected or explicitly requested

2. **Validation hooks**:
   - Allow commands to validate parameter content
   - Provide helpful error messages for common mistakes

3. **Alternative formats**:
   - JSON input support (for programmatic use)
   - YAML input support (for complex structures)
