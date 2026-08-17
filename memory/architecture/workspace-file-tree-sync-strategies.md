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

## Related

- [OKF document taxonomy](okf-document-taxonomy.md)
