# PRD: Multi-Task Attachments

## Feature Summary

Enable users to attach multiple backlog tasks to a single chat message, providing richer context for AI agents.

## User Story

As a user managing a development team chatroom, I want to attach multiple related backlog tasks when I send a message, so that the AI agent has complete context about all the work I'm assigning.

## Current Experience

1. User opens backlog in sidebar
2. Clicks on a task to view details
3. Clicks "Move to Chat"
4. Modal opens for single task
5. User enters message and sends
6. **Problem**: Cannot attach multiple tasks

## Proposed Experience

1. User opens backlog in sidebar
2. Clicks on a task to view details
3. Clicks "Add to Chat" → Task appears as chip above message input
4. User can repeat for more tasks (up to 10)
5. Chips show: `[📎 Fix auth bug ×] [📎 Add login page ×]`
6. User types message and sends
7. All attached tasks are marked as "started"

## UI/UX Specifications

### Chip Display

```
┌─────────────────────────────────────────────────────┐
│ [📎 Fix authentication... (×)] [📎 Add login... (×)]│
├─────────────────────────────────────────────────────┤
│ Type a message...                         [Send]    │
└─────────────────────────────────────────────────────┘
```

### Chip Styling

- Background: `bg-chatroom-bg-tertiary`
- Border: `border border-chatroom-border`
- Text: `text-xs text-chatroom-text-secondary`
- Icon: `Paperclip` (12px)
- Remove button: `X` (12px), hover highlight

### Button States

| State | "Add to Chat" Button |
|-------|---------------------|
| Normal | Enabled, shows icon + text |
| At limit (10) | Disabled, shows tooltip "Maximum 10 attachments" |
| Already attached | Disabled, shows "Already added" |

## Acceptance Criteria

- [ ] User can add backlog task to attachment queue
- [ ] Adding task closes TaskDetailModal
- [ ] Chips display above SendForm textarea
- [ ] User can remove individual chips
- [ ] User can attach up to 10 tasks
- [ ] Button disabled at limit with tooltip
- [ ] Sending message clears all chips
- [ ] All attached tasks marked as "started" after send
- [ ] MoveToChatModal removed from codebase

## Technical Notes

- Backend already supports `attachedTaskIds` array
- Backend already marks all attached tasks as started
- Need new `AttachedTasksContext` for state management
- Need `AttachedTaskChip` and `AttachedTasksRow` components

## Future Considerations

- Extend attachment system for images
- Drag-and-drop reordering of chips
- Attachment previews on hover
- Persist attachments across page refreshes
