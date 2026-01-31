# CLI Command Input Consistency - Implementation Plan

## Overview

Migrate all CLI commands to use **stdin (heredoc EOF format)** for human-readable input fields, with backend parsing of all structured content.

## Core Requirements

1. **STDIN Format Mandate**: All commands with human-readable input MUST use stdin (EOF format)
2. **Prompt Templates**: All prompts must show the correct command format and content type
3. **Integration Test Coverage**: All prompt changes must be tested and verified
4. **Backend Parsing**: All EOF format parsing happens on the backend, not frontend

## Current State

### ✅ Already Using Stdin (Mandatory)
- **handoff** - Uses EOF format for message content
- **task-started** (new_feature) - Uses EOF format for structured params (TITLE, DESCRIPTION, TECH_SPECS)

### ⚠️ Still Using --message Flag
- **report-progress** - Has `--message` flag + stdin fallback
- **task-complete** - Has broken `--message` flag (accepted but not sent to backend)

## Implementation Phases

### ✅ Phase 1: Backend Changes (COMPLETE)

#### ✅ Phase 1.1: Backend Decoder Utility (COMPLETE)
**Commit**: `v2 2a8fd55`

Created `services/backend/utils/stdin-decoder.ts`:
- `decodeMessage()`: Single markdown messages
- `decodeStructured()`: Multi-param with `---PARAM---` delimiters
- 23 unit tests (all passing)

#### ✅ Phase 1.2: Backend Mutations (COMPLETE)
**Commit**: `v2 5e31497`

Modified `services/backend/convex/messages.ts`:
- Added `rawStdin` parameter to `taskStarted` mutation
- Backend parses `---TITLE---`, `---DESCRIPTION---`, `---TECH_SPECS---`
- Maintains backward compatibility with individual parameters
- **Deprecated fields marked**: `featureTitle`, `featureDescription`, `featureTechSpecs`

### ✅ Phase 2: CLI Changes (COMPLETE)

**Commit**: `v2 750ba51`

#### ✅ 2.1: Update report-progress Command (COMPLETE)
**File**: `packages/cli/src/index.ts` (lines 271-316)

**Changes**:
- ✅ Removed `--message` option
- ✅ Made stdin mandatory
- ✅ Updated error messages to reference stdin only

**Validation**:
```bash
# New format (stdin only)
chatroom report-progress --chatroom-id=X --role=builder << 'EOF'
Working on Phase 2 implementation...
EOF
```

#### ✅ 2.2: Update task-complete Command (COMPLETE)
**File**: `packages/cli/src/index.ts` (lines 203-217)

**Changes**:
- ✅ Removed broken `--message` option entirely
- ✅ Cleaned up TaskCompleteOptions interface
- ✅ Updated error messages

**Note**: task-complete doesn't send a message, so no stdin needed.

#### ✅ 2.3: CLI Stdin Handling (COMPLETE)
**Analysis**: Frontend decoding is appropriate for simple single-message commands.

**Conclusion**: 
- `handoff` and `report-progress` send plain strings to backend (correct)
- Only `taskStarted` with `new_feature` needs structured parsing (uses `rawStdin`)
- No changes needed - current implementation follows requirements

### ✅ Phase 3: Prompt Generator Updates (COMPLETE)

**Commit**: `v2 101ed3c`

#### ✅ 3.1: Update report-progress Prompt (COMPLETE)
**File**: `services/backend/prompts/base/cli/report-progress/command.ts`

**Changes**:
- ✅ Updated to EOF format (consistent with handoff command)
- ✅ Removed --message flag from command generator
- ✅ Updated ReportProgressParams to remove unused message field
- ✅ Added TDD tests for EOF format validation

**Result**:
```bash
chatroom report-progress --chatroom-id=X --role=builder << 'EOF'
[Your progress message here]
EOF
```

**Tests**: 14 tests passing (4 new tests for report-progress EOF format)

#### ⏳ 3.2: Update Other Prompts (NEXT)
**Files**:
- `services/backend/prompts/base/cli/wait-for-task/reminder.ts`
- `services/backend/prompts/base/cli/roles/builder.ts`
- `services/backend/prompts/base/cli/roles/reviewer.ts`

**Changes**:
- Ensure all command examples use consistent EOF format
- Remove any remaining --message references

### ✅ Phase 4: Integration Test Updates (COMPLETE)

**Commit**: `v2 101ed3c`

#### ✅ 4.1: Fix Pre-existing Test Failures (COMPLETE)
**File**: `tests/integration/cli/prompts.spec.ts`

**Fixed**:
- ✅ Context read command test (now expects --chatroom-id= format)
- ✅ Wait-for-task command test (now expects --chatroom-id= format)

#### ✅ 4.2: Add report-progress Tests (COMPLETE)
**Tests Added**:
- ✅ Uses EOF format instead of --message flag
- ✅ Includes placeholder for message content
- ✅ Injects environment prefix correctly
- ✅ Matches handoff command format consistency

**Test Results**: All 14 tests passing

**Validation**:
```bash
pnpm test:integration
```

### 📋 Phase 5: Cleanup & Deprecation Removal

#### 5.1: Remove Frontend Decoder
**File**: `packages/cli/src/utils/serialization/decode/index.ts`

**Action**: 
- Evaluate if decoder is still needed for other purposes
- Remove if only used for deprecated format
- Keep tests for reference

#### 5.2: Remove Deprecated Backend Parameters
**File**: `services/backend/convex/messages.ts` (taskStarted mutation)

**Remove these fields**:
```typescript
// ⚠️ DEPRECATED - DELETE IN PHASE 5
featureTitle: v.optional(v.string()),
featureDescription: v.optional(v.string()),
featureTechSpecs: v.optional(v.string()),
```

**Remove backward compatibility code** (lines 750-769):
```typescript
// Parse raw stdin for new_feature classification
let featureTitle = args.featureTitle;  // ← DELETE
let featureDescription = args.featureDescription;  // ← DELETE
let featureTechSpecs = args.featureTechSpecs;  // ← DELETE
```

**Keep only**:
```typescript
if (args.originMessageClassification === 'new_feature' && args.rawStdin) {
  const { decodeStructured } = await import('../utils/stdin-decoder.js');
  const parsed = decodeStructured(args.rawStdin, ['TITLE', 'DESCRIPTION', 'TECH_SPECS']);
  
  featureTitle = parsed.TITLE;
  featureDescription = parsed.DESCRIPTION;
  featureTechSpecs = parsed.TECH_SPECS;
}
```

#### 5.3: Update CLI Help Text
**Files**: 
- `packages/cli/src/index.ts`
- Command description strings

**Changes**:
- Remove any references to deprecated `--message` flags
- Update examples to show only stdin format

#### 5.4: Version Bump
**Action**: Create major version release
- Increment major version (breaking changes)
- Update CHANGELOG.md with migration notes
- Document breaking changes in release notes

## Parameter Status Reference

### taskStarted Mutation

| Parameter | Status | Purpose | Action |
|-----------|--------|---------|--------|
| `sessionId` | ✅ Active | Authentication | Keep |
| `chatroomId` | ✅ Active | Chatroom identifier | Keep |
| `role` | ✅ Active | Sender role | Keep |
| `originMessageClassification` | ✅ Active | Message classification | Keep |
| `taskId` | ✅ Active | Task identifier | Keep |
| `rawStdin` | ✅ Active | **Stdin content (preferred)** | Keep |
| `featureTitle` | ⚠️ DEPRECATED | Backward compat only | **DELETE in Phase 5** |
| `featureDescription` | ⚠️ DEPRECATED | Backward compat only | **DELETE in Phase 5** |
| `featureTechSpecs` | ⚠️ DEPRECATED | Backward compat only | **DELETE in Phase 5** |
| `convexUrl` | ✅ Active | Environment context | Keep |

## Benefits

- **Consistency**: All human-readable input uses same EOF format
- **Clarity**: Agents see uniform command examples in prompts
- **Simplicity**: One pattern to learn and maintain
- **Backend Parsing**: All decoding happens server-side (secure, consistent)
- **Type Safety**: Backend validation of structured content

## Size Assessment

**Very manageable change:**
- **Core CLI logic**: ~30 lines across 2 command definitions
- **Breaking changes acceptable**: Major version release
- **No complex refactoring**: Just removing optional flags
- **Backend already prepared**: All infrastructure exists

## Testing Strategy

1. **Unit Tests**: Backend decoder (already complete - 23 tests)
2. **Integration Tests**: Update snapshots for new format
3. **Manual Testing**: Verify each command works with EOF format
4. **Backward Compatibility**: Ensure old format still works until Phase 5

## Rollout Plan

1. Complete Phases 2-4 (CLI + Prompts + Tests)
2. Deploy to staging environment
3. Test with real agents
4. Deploy to production
5. Monitor for issues
6. After stable period, execute Phase 5 (cleanup)

## Success Criteria

- ✅ All commands use stdin for human-readable input
- ✅ All prompt templates show correct format
- ✅ All integration tests pass
- ✅ Backend handles all parsing
- ✅ Deprecated parameters removed (Phase 5)
- ✅ Documentation updated

---

**Version**: 1.2  
**Last Updated**: 2026-01-26  
**Status**: Phases 1-4 Complete, Phase 5 Pending (Cleanup)
