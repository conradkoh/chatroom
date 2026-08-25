# Architecture

- [OKF document taxonomy](okf-document-taxonomy.md) — strict folder and document-type rules for this memory bundle
- [Developer page conventions](developer-page-conventions.md) — `/developer` route structure, Component Storybook registry, and navigation patterns
- [Workspace file tree sync strategies](workspace-file-tree-sync-strategies.md) — pluggable blob/sharded snapshot strategies (replaces V2/V3)
- [Workspace file-tree sync queue and daemon lifecycle](workspace-file-tree-sync-queue.md) — per-workspace queue, debounce, orphan reap, walk exclusions
- [Request-first enhancer workflow](request-first-enhancer-workflow.md) — one memoryless analysis pass before the stateful Solo or Duo entry point begins work
- [Agent stop golden path](agent-stop-golden-path.md) — durable aggregate stops, exact-target execution, projection-driven UI
