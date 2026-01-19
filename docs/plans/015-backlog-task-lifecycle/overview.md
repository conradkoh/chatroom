# Plan 015: Backlog Task Lifecycle

## Summary

This plan adds a dedicated backlog lifecycle tracking system that keeps tasks visible in the backlog list even after they are moved to the queue. Tasks only disappear from the backlog view when a user explicitly marks them as complete or closed. This provides better visibility into which backlog items have been addressed.

## Goals

1. **Persistent Backlog Visibility**: Tasks moved from backlog to queue remain visible in the backlog list until user confirmation
2. **User-Controlled Completion**: Only users (not agents) can mark backlog items as complete
3. **Archived Task Browsing**: Provide a way to view completed/closed backlog items in an expandable section
4. **Reopening Capability**: Allow users to reopen closed/completed tasks if needed

## Non-Goals

- Agent-triggered task completion for backlog items
- Complex pagination for archived items (simple expandable section is sufficient for MVP)
- Historical analytics on backlog completion rates
- Backlog priority or ordering changes
