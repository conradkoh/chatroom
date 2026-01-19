# Plan 010: Phase 1 Audit Findings

## Summary

Conducted a comprehensive audit of the agent prompt system. The current implementation is largely correct, with a few areas for improvement.

## Files Audited

### Frontend Init Prompts
| File | Purpose | Status |
|------|---------|--------|
| `init/wait-for-task.ts` | wait-for-task lifecycle | ✅ Good |
| `init/task-started.ts` | Classification instructions | ✅ Good |
| `init/base.ts` | Core prompt sections | ⚠️ Minor |
| `init/roles.ts` | Role-specific guidance | ✅ Good |
| `generator.ts` | Prompt composition | ✅ Good |

### Backend Role Prompts
| File | Purpose | Status |
|------|---------|--------|
| `prompts/generator.ts` | Role prompt generation | ⚠️ Minor |
| `prompts/templates.ts` | Role templates | ✅ Good |

### Message Handling
| File | Purpose | Status |
|------|---------|--------|
| `messages.ts:getLatestForRole` | Message routing | ✅ Good |
| `messages.ts:getContextWindow` | Context for agents | ✅ Good |

---

## Findings by Backlog Item

### #20: Agent Prompts Reliability (wait-for-task)

**Current State:** ✅ Mostly Good

**Frontend `wait-for-task.ts` (lines 36-49):**
```
The `wait-for-task` process may terminate unexpectedly due to:
- **SIGTERM/SIGINT/SIGHUP** - External signals
- **Task cancellation** - The user cancelled the task
- **Process timeout** - The wait session exceeded its duration

**IMPORTANT:** If the wait-for-task process terminates for ANY reason, 
you MUST immediately restart it
```

**Frontend `base.ts` (line 102):**
```
**Restart immediately after unexpected termination:** If your `wait-for-task` 
process is killed (SIGTERM, SIGINT, timeout, or any other signal), 
immediately restart it.
```

**Backend `generator.ts` (line 162):**
```
**⚠️ If wait-for-task is killed unexpectedly (SIGTERM, timeout, etc.), 
immediately restart it!**
```

**Issue:** The wording is slightly different between files, but the message is consistent.

**Recommendation:** No changes needed. The current instructions are clear.

---

### #2: Reviewer Role Regression

**Current State:** ✅ Good

**Frontend `roles.ts:getReviewerGuidance` (lines 57-99):**
```
**Important: Do NOT run `task-started`** - The task has already been classified 
by the builder.
```

**Backend `generator.ts:getReviewerWorkflow` (lines 83-98):**
```
**Note: Do NOT run task-started** - the task is already classified by the builder.
```

**Frontend `generator.ts` (line 66):**
- Entry point check correctly excludes task-started section for reviewer
- `isEntryPoint ? getTaskStartedSection(ctx) : ''`

**Issue:** Wording differs ("Important" vs "Note"). Should be consistent.

**Recommendation:** 
1. Use consistent language "**Important:** Do NOT run `task-started`" in both places
2. Keep the wording strong and visible

---

### #15: Reviewer Retrieves Incorrect Messages

**Current State:** ✅ Good

**`messages.ts:getLatestForRole` logic (lines 901-920):**
1. Targeted messages → only go to target role ✅
2. User messages → only go to entry point ✅  
3. Broadcast messages → go to highest priority waiting ✅

The reviewer should only receive:
- Messages with `targetRole: 'reviewer'` (handoffs)
- Interrupt messages (line 897)

**No issues found.** The routing logic is correct.

---

## Discrepancies Found

### 1. "Do NOT run task-started" wording

| Location | Wording |
|----------|---------|
| Frontend `roles.ts` | "**Important:** Do NOT run `task-started`" |
| Backend `generator.ts` | "**Note:** Do NOT run task-started" |

**Recommendation:** Standardize on "**Important:** Do NOT run `task-started`"

### 2. wait-for-task instruction formatting

| Location | Emphasis Level |
|----------|----------------|
| Frontend `wait-for-task.ts` | Bold **IMPORTANT** with details |
| Backend `generator.ts` | ⚠️ emoji with shorter text |

**Recommendation:** Both are clear, no change needed.

---

## Conclusion

**No critical issues found.** The prompt system is well-structured and consistent.

### Minor Improvements Recommended:

1. **Standardize reviewer "Do NOT run task-started" wording** - Use "**Important:**" consistently
2. **Keep monitoring** - The current system is working correctly

### Phase 2 & 3 Updates:

Given the audit findings:
- **Phase 2 (wait-for-task):** No changes needed - current instructions are sufficient
- **Phase 3 (Reviewer issues):** Minor wording consistency fix only
- **Phase 4 (Verification):** May be combined with Phase 3

---

## Validation

- [x] All prompt files audited
- [x] Backend and frontend prompts compared
- [x] Message routing logic reviewed
- [x] Issues documented with specific line references
