# Commit-Backlog Analysis Report

This document analyzes unpushed commits and verifies they achieved their intended goals from the backlog.

## Unpushed Commits (16 total)

| Commit    | Message                                                     | Related Backlog Task            | Status           |
| --------- | ----------------------------------------------------------- | ------------------------------- | ---------------- |
| `118d83e` | perf: replace polling with WebSocket subscription           | N/A (follow-up fix)             | ✅ Complete      |
| `374cd51` | perf: optimize high-frequency backend function calls        | #12 Validate usage performance  | ⚠️ Superseded    |
| `ca5cdbd` | feat: show (Local) in title for local development           | #21 UX: Local title             | ❌ Issue Found   |
| `fd1c9dc` | feat: automatically clean up consumed tmp/chatroom files    | #30 DX: Auto cleanup tmp        | ✅ Complete      |
| `77b09fb` | feat: deprecate features list CLI command                   | Cleanup: deprecate feature list | ❌ Incomplete    |
| `a37de3e` | feat: show P/C/V elements in full task queue modal          | UI task queue modal             | ✅ Complete      |
| `0f5b094` | feat: improve backlog commands prompt with tagging guidance | DX: Backlog tagging             | ✅ Complete      |
| `6430ee0` | docs: add CLI development guidelines                        | N/A (unexpected)                | ⚠️ Review Needed |
| `832cb70` | feat: add artifact types to CLI API and sync system         | Artifact System                 | ✅ Complete      |
| `80adcff` | feat: update CLI commands for artifact support              | Artifact System                 | ✅ Complete      |
| `9409420` | feat: implement artifact CLI commands with error formatting | Artifact System                 | ✅ Complete      |
| `9e16070` | feat: add artifact system with versioning support           | Artifact System                 | ⚠️ Review Needed |
| `025ae66` | docs: fix CLI flag naming in Plan 020 documentation         | Plan 020 fixes                  | ✅ Complete      |
| `f0c6b44` | feat: implement task lifecycle reliability improvements     | Plan 020                        | ✅ Complete      |
| `7f6e947` | fix(prompts): use --task-id flag consistently               | Plan 020 fixes                  | ✅ Complete      |
| `b1cf870` | ignore tmp folder                                           | DX: gitignore                   | ✅ Complete      |

---

## Issues Found

### 1. ❌ Local Title Header (`ca5cdbd`)

**Backlog Task #21:** UX: When both the chatroom and convex backend are started locally, the webapp page title should show (Local)

**Expected Behavior:** Use configured URLs to determine if running locally (comparing webapp URL vs production URL)

**Actual Implementation:** Uses `NODE_ENV === 'development'` check

**Problem:** The `NODE_ENV` approach doesn't actually detect local vs production based on URLs. It only checks if running in development mode, which could be misleading in some deployment scenarios.

**Fix Required:**

```typescript
// Current (incorrect)
title: process.env.NODE_ENV === "development" ? "Chatroom (Local)" : "Chatroom";

// Should compare configured URLs instead
// e.g., check if NEXT_PUBLIC_CONVEX_URL matches production URL
```

---

### 2. ❌ Feature List Command Deprecation (`77b09fb`)

**Backlog Task:** Cleanup: deprecate features list CLI command

**Expected:** Remove the command and all references

**Actual:** Only added deprecation warning and removed from prompt context

**Problem:** The command still exists and is functional. The task asked for removal, not deprecation.

**Files Still Containing the Command:**

- `packages/cli/src/commands/feature.ts` - command still exists with deprecation warning
- `packages/cli/src/index.ts` - command still registered

**Fix Required:** Either:

1. Actually remove the command entirely, OR
2. Update the backlog task to clarify that deprecation (not removal) was the intended approach

---

### 3. ⚠️ Unexpected CLI Guidelines Doc (`6430ee0`)

**Commit:** docs: add CLI development guidelines

**Issue:** This commit adds `docs/cli-conventions.md` (359 lines) but there's no corresponding backlog task requesting this documentation.

**Assessment:** The document appears valuable for maintaining CLI consistency, but should have been tracked in the backlog. This may have been created as part of the CLI Convention Improvements feature but wasn't explicitly requested.

**Action:** No code fix needed, but process improvement - ensure all significant work is tracked in backlog.

---

### 4. ⚠️ Artifact System - mimeType Field (`9e16070`)

**Backlog Task:** Artifact System implementation

**Concern:** The `mimeType` field in the schema (`services/backend/convex/schema.ts:500`)

**Current Implementation:**

```typescript
chatroom_artifacts: defineTable({
  // ...
  mimeType: v.string(), // Required field
  // ...
});
```

**Questions to Consider:**

1. Is mimeType necessary if we only support `.md` files initially?
2. Should it be optional or have a default value?
3. Current usage always sets it to `'text/markdown'` - is the field adding value?

**Assessment:** Not a bug, but a design question. The field provides forward compatibility for future file type support, but adds slight complexity. **Recommend keeping** for extensibility, but could simplify by making it optional with a default.

---

### 5. ⚠️ Polling Optimization Superseded (`374cd51`)

**Commit:** perf: optimize high-frequency backend function calls

**Status:** This commit implemented polling optimizations (adaptive backoff, longer intervals) that have now been **superseded** by commit `118d83e` which replaced polling entirely with WebSocket subscriptions.

**Assessment:** The polling code from this commit is now unused. Some cleanup may be beneficial:

- `WAIT_POLL_INTERVAL_MS` in config - no longer used
- `MAX_SILENT_ERRORS` in config - no longer used

**Action:** These unused constants can be removed in a future cleanup commit.

---

## Summary

| Category                       | Count |
| ------------------------------ | ----- |
| ✅ Complete (verified working) | 10    |
| ❌ Issues requiring fixes      | 2     |
| ⚠️ Review/discussion needed    | 4     |

### Priority Fixes

1. **High:** Fix Local title detection to use URL comparison instead of NODE_ENV
2. **Medium:** Clarify feature list deprecation vs removal requirement
3. **Low:** Clean up unused polling constants
