# Implementation Phases: Multi-Task Attachments

## Phase 1: Create AttachedTasksContext

**Goal**: Create state management for attached tasks

### Tasks

1. Create `AttachedTasksContext.tsx`:
   - Define `AttachedTask` interface
   - Define `AttachedTasksContextValue` interface
   - Create context with `MAX_ATTACHMENTS = 10`
   - Implement `addTask`, `removeTask`, `clearTasks`
   - Export `AttachedTasksProvider` and `useAttachedTasks` hook

2. Add provider to `ChatroomDashboard.tsx`:
   - Import and wrap content with `AttachedTasksProvider`

### Validation

- Context can be accessed from child components
- State updates correctly on add/remove/clear

---

## Phase 2: Create UI Components

**Goal**: Create the chip display components

### Tasks

1. Create `AttachedTaskChip.tsx`:
   - Display truncated task content (max ~30 chars)
   - Paperclip icon prefix
   - Remove button (×)
   - Hover states for accessibility

2. Create `AttachedTasksRow.tsx`:
   - Flex container for chips
   - Shown conditionally when tasks.length > 0
   - Scroll horizontal if many chips

### Validation

- Chips render correctly
- Remove button works
- Overflow handled gracefully

---

## Phase 3: Update SendForm

**Goal**: Integrate attachments into message sending

### Tasks

1. Import `useAttachedTasks` hook
2. Add `AttachedTasksRow` above textarea
3. Update `sendMessage` call to include `attachedTaskIds`
4. Call `clearTasks()` after successful send
5. Handle errors (don't clear on failure)

### Validation

- Chips appear above input
- Message sends with attached task IDs
- Chips clear after send

---

## Phase 4: Update TaskDetailModal

**Goal**: Replace modal flow with context-based add

### Tasks

1. Import `useAttachedTasks` hook
2. Replace modal open logic:
   - Old: `setIsMoveToChatOpen(true)`
   - New: `addTask(task); onClose();`
3. Remove `MoveToChatModal` import and usage
4. Handle limit reached (show toast or disable button)

### Validation

- "Add to Chat" adds task to chips
- Modal closes after adding
- Button disabled when limit reached

---

## Phase 5: Cleanup

**Goal**: Remove deprecated code

### Tasks

1. Delete `MoveToChatModal.tsx`
2. Remove any unused imports
3. Update any tests referencing removed components

### Validation

- No broken imports
- Build passes
- All tests pass

---

## Phase 6: Polish

**Goal**: Improve UX and edge cases

### Tasks

1. Add toast notification when task is added
2. Prevent duplicate task additions
3. Handle task deleted while attached (validate on send)
4. Add keyboard navigation for chips

### Validation

- Toast appears on add
- Duplicates prevented
- Graceful error on invalid task
