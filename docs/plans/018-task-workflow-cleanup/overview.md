# Plan 018: Task Workflow Cleanup

## Summary

Cleanup of legacy code and technical debt introduced during the task workflow refactor (Plan 017). This plan removes deprecated fields, consolidates duplicate logic, and improves code maintainability.

## Goals

1. **Remove legacy fields** - Clean up deprecated `backlog` field and `cancelled` status
2. **Consolidate logic** - Remove dual origin detection code
3. **Reduce duplication** - Share types across frontend components
4. **Improve maintainability** - Single source of truth for all workflow logic

## Non-Goals

- Adding new features
- Changing user-facing behavior
- Modifying the task workflow state machines

## Prerequisites

**Critical:** The migration script `normalizeAllTaskOrigins` MUST be run before Phase 2 begins.

## Risk Assessment

| Phase | Risk Level | Impact if Skipped |
|-------|------------|-------------------|
| Phase 1 (Pre-Migration) | Low | Code quality only |
| Phase 2 (Post-Migration) | High | Breaking change if migration not run |
