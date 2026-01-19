# Plan 009: Convex Query Optimization

## Summary

This plan addresses write conflicts and reduces the number of database operations in Convex mutations. The primary focus is on eliminating race conditions in queue position calculations and reducing redundant queries in high-frequency operations like handoffs.

## Goals

1. **Eliminate queue position race conditions** - Ensure atomic queue position assignment using a counter pattern
2. **Reduce duplicate queries** - Have `requireChatroomAccess` return the chatroom object to avoid re-fetching
3. **Optimize handoff operations** - Reduce the ~15 database operations per handoff to ~8-10
4. **Improve query patterns** - Reduce redundant participant queries in common operations

## Non-Goals

- Complete architectural refactor of the task system
- Changing the public API surface of mutations/queries
- Adding new features or functionality
- Denormalization of task counts (deferred to future iteration)

## Impact Assessment

| Metric | Before | After (Expected) |
|--------|--------|------------------|
| Handoff operations | ~15 | ~8-10 |
| Queue position conflicts | Possible | None |
| Duplicate chatroom fetches | 1-2 per mutation | 0 |
