# Plan 014: Implementation Phases

## Phase 1: Desktop Breakpoint Detection

**Goal:** Add hook to detect desktop viewport

**Changes:**
- Create `useIsDesktop` hook in shared hooks folder
- Use `lg` breakpoint (1024px) as threshold
- Handle SSR gracefully (default to false)

**Success Criteria:**
- [ ] Hook correctly detects desktop viewport
- [ ] Works with server-side rendering
- [ ] TypeCheck passes

---

## Phase 2: Expand Modal Size on Desktop

**Goal:** Make modal larger on desktop

**Changes:**
- Update modal responsive classes
- `lg:max-w-5xl` for wider modal
- `lg:max-h-[90vh]` for taller modal
- Test on various screen sizes

**Success Criteria:**
- [ ] Modal is wider on desktop
- [ ] Modal is taller on desktop
- [ ] Mobile/tablet unchanged

---

## Phase 3: Split-Panel Editing Layout

**Goal:** Side-by-side editor and preview on desktop

**Changes:**
- When `isEditing && isDesktop`:
  - Left panel: textarea editor
  - Right panel: live Markdown preview
- Both panels scrollable independently
- Sync scroll optional (future enhancement)

**Success Criteria:**
- [ ] Desktop shows split view when editing
- [ ] Preview updates in real-time
- [ ] Mobile shows single-panel (unchanged)

---

## Phase 4: Polish & Testing

**Goal:** Finalize UX and test edge cases

**Changes:**
- Adjust spacing and typography
- Test with very long content
- Test with very short content
- Ensure dark mode works
- Keyboard shortcuts (Ctrl+Enter to save)

**Success Criteria:**
- [ ] Works with 2-line content
- [ ] Works with 200-line markdown requirements
- [ ] Dark mode verified
- [ ] All existing functionality preserved

---

## Phase Dependencies

```
Phase 1 (Hook) → Phase 2 (Size) → Phase 3 (Split) → Phase 4 (Polish)
```

## Estimated Timeline

| Phase | Duration |
|-------|----------|
| Phase 1 | 15 min |
| Phase 2 | 20 min |
| Phase 3 | 45 min |
| Phase 4 | 30 min |
| **Total** | **~2 hours** |

## Current Status

- [ ] Phase 1: Desktop Breakpoint Detection
- [ ] Phase 2: Expand Modal Size on Desktop
- [ ] Phase 3: Split-Panel Editing Layout
- [ ] Phase 4: Polish & Testing
