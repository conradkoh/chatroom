# Plan 015: Backlog Task Lifecycle - PRD

## Glossary

| Term | Definition |
|------|------------|
| **Backlog Status** | A new property on tasks that tracks the lifecycle of a backlog item, independent of the task's queue status |
| **Active Backlog** | Tasks with backlog status `not_started` or `started` - shown in the main backlog list |
| **Archived Backlog** | Tasks with backlog status `complete` or `closed` - hidden from main list, viewable in archive section |
| **Reopen** | The action of changing a task's backlog status from `complete`/`closed` back to `started` |

## Backlog Status Values

| Status | Description |
|--------|-------------|
| `not_started` | Default state - task is in backlog, work has not begun |
| `started` | Task has been moved to queue at least once - work has begun |
| `complete` | User has confirmed the issue is resolved |
| `closed` | User has closed the task without completing (e.g., won't fix, duplicate) |

## User Stories

### US-1: Backlog Task Persistence
**As a** user  
**I want** tasks that are moved to the queue to remain visible in the backlog list  
**So that** I can track which backlog items still need my confirmation before they disappear

### US-2: Mark Backlog Complete
**As a** user  
**I want** to mark a backlog item as complete  
**So that** I can confirm the issue has been resolved and remove it from the active list

### US-3: Close Backlog Item
**As a** user  
**I want** to close a backlog item without marking it complete  
**So that** I can remove items that are duplicates, won't fix, or no longer relevant

### US-4: View Archived Items
**As a** user  
**I want** to see completed and closed backlog items in an expandable archive section  
**So that** I can review past work and find previously resolved items

### US-5: Reopen Backlog Item
**As a** user  
**I want** to reopen a completed or closed backlog item  
**So that** I can address issues that have resurfaced or were closed prematurely

## UI Behavior

### Backlog List View

```
┌────────────────────────────────┐
│ BACKLOG (3 active)             │
├────────────────────────────────┤
│ • Fix login button [not_started] │
│ • Add dark mode [started]        │  ← moved to queue previously
│ • Update docs [started]          │  ← moved to queue previously
├────────────────────────────────┤
│ ▶ Archived (5)                 │  ← expandable section
└────────────────────────────────┘
```

### Expanded Archive Section

```
┌────────────────────────────────┐
│ ▼ Archived (5)                 │
├────────────────────────────────┤
│ • Feature X [complete] - Jan 18│
│ • Bug Y [closed] - Jan 17      │
│ • Feature Z [complete] - Jan 15│
│ (ordered by updated date desc) │
└────────────────────────────────┘
```

### Task Detail Modal Actions

For active backlog items (`not_started` or `started`):
- Edit
- Delete
- Move to Queue
- **Mark Complete** (new)
- **Close** (new)

For archived items (`complete` or `closed`):
- View (read-only)
- **Reopen** (new)
