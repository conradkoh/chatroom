---
type: decision-log
title: Workspace file tree sync strategies
description: Pluggable blob/sharded snapshot strategies replacing V2/V3 branching for workspace file-tree sync.
tags: [workspace, file-tree, architecture, sync]
status: proposed
---

# Workspace file tree sync strategies

## Context

Workspace file trees are synced from daemon → Convex → webapp. Today, “V2” (single blob) and “V3” (sharded manifest) are hardcoded with selection logic duplicated across CLI, Convex handlers, and webapp hooks. This caused loading deadlocks and a 2848-line `workspaceFiles.ts` god module.

## Decision

Replace V2/V3 version naming with pluggable snapshot strategies behind one interface:

| Strategy ID | Replaces | When              |
| ----------- | -------- | ----------------- |
| `blob`      | V2       | Tree JSON ≤ 900KB |
| `sharded`   | V3       | Tree JSON > 900KB |

## Architecture

1. UI requests a tree through `requestFileTree`.
2. The daemon scans and selects a strategy through the domain registry.
3. The strategy publishes a snapshot and the daemon publishes a checkpoint.
4. Convex updates hydrate the webapp store through the selected strategy.
5. Filesystem changes continue through revisioned deltas.

The Convex checkpoint remains the source of truth for the active strategy and snapshot. Delta/checkpoint revisions, the webapp store, and request transport remain unchanged.

## Consequences

New storage formats become new strategies instead of new version branches. Existing V2/V3 tables remain available through strategy repositories during migration.

## Pragmatic scope (2026-08)

This wiring lands as a single PR. Convex continues to use ephemeral `snapshotKind` values (`v2`/`v3`) at some transport boundaries, mapped with `strategyIdToSnapshotKind` and `snapshotKindToStrategyId`.

**Checkpoint schema migration (required):** `chatroom_workspaceFileTreeCheckpoint` renamed `snapshotKind` → `strategyId` (`blob` / `sharded`). Existing rows must be migrated via `migrateFileTreeCheckpointToStrategyId` in `services/backend/convex/migrations.ts` (wired into `runAll`) before clients read checkpoints after deploy. Decomposition of `workspaceFiles.ts` is deferred.

## Watch lifecycle (2026-08)

File-tree sync and daemon coordinators are bound to UI watches, not ambient chatroom dashboard mount:

- Explorer sidebar (`FileExplorerPanel` mounted)
- File selector (Cmd+P modal open)
- `@` file-reference autocomplete visible

Webapp ref-counts watches per workspace and calls `adjustFileTreeWatch` (+1/-1). When the Convex watch count returns to zero, a release request stops the daemon coordinator for that working directory. Cached entries remain in `workspaceFileTreeStore` for stale reads until the next watch.

## Related

- [OKF document taxonomy](okf-document-taxonomy.md)
