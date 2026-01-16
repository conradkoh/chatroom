# Plan 003: Atomic Mutations

## Summary

Consolidate multiple sequential API mutations into single atomic backend operations. Currently, CLI commands like `task-complete` make 3 separate mutation calls that should be a single atomic transaction.

## Goals

1. **Atomicity**: Each user action triggers exactly one mutation that handles all related changes
2. **Consistency**: Eliminate race conditions and partial state updates
3. **Simplicity**: CLI and frontend become thin clients that just call the backend
4. **Reliability**: If any part of an operation fails, the entire operation fails cleanly

## Non-Goals

- Changing the user-facing behavior or API semantics
- Modifying query calls (reads are fine to have multiple)
- Changing the data model or schema
