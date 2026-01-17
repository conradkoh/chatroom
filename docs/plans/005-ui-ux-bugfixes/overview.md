# Plan 005: UI/UX Bug Fixes

## Summary

Fix 4 UI bugs in the chatroom webapp that affect user experience:
1. Loading cards not clickable until agent statuses load
2. 3-dot menu overlapping status badge in chatroom cards
3. Tables/markdown causing horizontal scroll
4. Task status icons using emoji circles instead of squares

## Goals

1. **Improve interaction responsiveness** - Cards should be clickable immediately
2. **Fix visual overlaps** - Menu button should not cover status badge
3. **Prevent layout overflow** - Tables and code blocks stay within container
4. **Follow design conventions** - Replace emoji circles with squares per theme.md

## Non-Goals

- Redesigning the card layout entirely
- Adding new features to chatroom listing
- Changing the task status system behavior
- Mobile-specific optimizations beyond overflow handling
