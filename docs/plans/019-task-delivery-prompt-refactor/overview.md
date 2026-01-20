# Plan 019: Task Delivery Prompt Refactor

## Summary

Refactor the wait-for-task CLI prompt construction to move all prompt generation logic from the CLI to the backend. The CLI will become a thin client that receives pre-formatted prompt sections from the backend and renders them directly.

## Goals

1. **Centralize prompt logic**: Move all prompt construction from CLI to backend for easier maintenance
2. **Enable role-based conditional sections**: Create a composable section system that renders different sections based on agent role
3. **Improve maintainability**: Make it easy to add, modify, or remove prompt sections without changing CLI code
4. **Preserve backward compatibility**: Ensure the transition doesn't break existing functionality
5. **Support gradual migration**: Allow incremental migration of sections from CLI to backend

## Non-Goals

- Changing the visual appearance of the wait-for-task output
- Adding new sections beyond what currently exists
- Modifying the wait-for-task polling mechanism
- Changing the task claiming logic
