# Plan 011: Message Lifecycle Tracking

## Summary

Add lifecycle tracking fields to messages (`acknowledgedAt`, `completedAt`) and a new index for efficient origin message lookup. Update the context window query to filter by lifecycle state, ensuring agents only see messages that have been actively worked on.

## Goals

1. **Eliminate task table scans** - Current `getContextWindow` joins with tasks table; new approach uses message fields directly
2. **Support long-running chatrooms** - Efficient queries for chatrooms with 100k+ messages
3. **Track message lifecycle** - Know when messages are seen, started, and completed
4. **Filter queued messages** - Reviewers should only see messages the builder has worked on

## Non-Goals

- UI changes to display lifecycle timestamps
- Historical analytics or reporting on lifecycle data
- Complex context chain tracking (may be added later)
- Backfilling existing data (migration handled separately if needed)
