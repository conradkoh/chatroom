# Serialization Decoder - Implementation Plan

## Created Files

1. **`encoding.md`** - Full specification for the encoding format
2. **`index.ts`** - Decoder implementation
3. **`index.test.ts`** - Comprehensive test suite

## Key Design Decisions

### 1. Delimiter Collision Handling

**Question**: "What if content contains the delimiter itself?"

**Answer**: Use strict line-matching rules

- Delimiter ONLY matches when on its own line: `^---PARAM_NAME---$`
- Inline occurrences like `text ---TITLE--- more text` are treated as content
- Delimiter with spaces like `  ---TITLE---  ` is treated as content

**Example that works**:
```
---DESCRIPTION---
The old code had this pattern:
  some text ---TITLE--- inline
Which was confusing but works fine here
```

**Example that causes error**:
```
---DESCRIPTION---
The old code had:
---TITLE---
← This is on its own line, so it's parsed as a delimiter!
```

**Error handling**: Clear error message with workaround suggestion

### 2. Two Modes of Operation

#### Single Parameter Mode
```typescript
decode(input, { singleParam: 'message' })
```
- Entire input is one parameter
- No delimiter parsing
- Perfect for simple commands like `handoff`

#### Multi Parameter Mode
```typescript
decode(input, {
  expectedParams: ['TITLE', 'DESCRIPTION', 'TECH_SPECS'],
  requiredParams: ['TITLE']
})
```
- Parses delimited structure
- Validates parameter names
- Checks for required parameters
- Perfect for complex commands like `task-started`

### 3. Content Preservation

- **Preserve**: Internal whitespace, empty lines, indentation
- **Trim**: Only leading/trailing newlines from final parameter value
- **Never**: Escape or modify user content

### 4. Error Handling

Errors include:
- `UNKNOWN_PARAM` - Parameter not in expected list
- `MISSING_PARAM` - Required parameter not provided
- `DUPLICATE_PARAM` - Same parameter appears twice
- `INVALID_FORMAT` - Content before first delimiter
- `COLLISION` - Reserved for future delimiter collision detection

All errors include:
- User-friendly message
- Line number (when applicable)
- Parameter name (when applicable)
- Helpful workaround suggestions

## Next Steps

### Phase 1: Implement decoder (Current)
- ✅ Specification written
- ✅ Decoder implemented
- ✅ Tests written
- ⏳ Run tests to verify
- ⏳ Fix any issues

### Phase 2: Integrate with handoff command
- Update `handoff` command to accept stdin
- Add `--message` flag as alternative to `--message-file`
- When neither provided, read from stdin
- Update prompts to use new format

### Phase 3: Integrate with task-started command
- Update `task-started` to accept stdin for multi-param mode
- Support both file-based and stdin-based input
- Update prompts to use structured format

### Phase 4: Update all generated prompts
- Remove file variable complexity
- Use simple HERE documents
- Update examples in all role prompts

## Usage Examples

### Handoff (Simple)
```bash
chatroom handoff abc123 --role=builder --next-role=user << 'EOF'
## Summary
Implemented authentication

## Testing
All tests pass
EOF
```

### Task Started (Structured)
```bash
chatroom task-started abc123 --role=builder --task-id=xyz --classification=new_feature << 'PARAMS'
---TITLE---
User Authentication
---DESCRIPTION---
Complete auth system with JWT tokens
---TECH_SPECS---
- Bcrypt password hashing
- 24h token expiry
PARAMS
```

## Benefits

1. **Simpler for agents**: No variable management, no timestamp evaluation timing issues
2. **No file system**: Eliminates file creation/cleanup
3. **More reliable**: Content goes directly to command
4. **Better errors**: Clear messages about what went wrong
5. **Extensible**: Easy to add new parameters or commands
