---
type: guide
title: What is OKF?
description: Overview of the Open Knowledge Format used as this repository's agent memory system.
tags: [okf, memory, agents]
status: stable
---

# What is OKF?

**Open Knowledge Format (OKF)** is an open, vendor-neutral specification for representing knowledge as a directory of markdown files with YAML frontmatter. Google introduced it to formalize the "LLM-wiki" pattern: curated, structured context that both humans and AI agents can read, write, and traverse without proprietary tooling.

## Why we use it

This repository adopts OKF as its **agent memory system** — persistent, version-controlled knowledge that agents and developers share. OKF fits our workflow because it is:

- **Just markdown** — readable in any editor, diffable in git, renderable on GitHub
- **Just files** — no database or proprietary SDK required to read or write
- **Agent-friendly** — `type`, `tags`, and `description` frontmatter enable filtering before reading full documents
- **Portable** — the bundle can be consumed by any OKF-aware tool or plain file search

## Core concepts

| Term                 | Meaning                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| **Knowledge bundle** | The `memory/` directory — a self-contained collection of concept documents |
| **Concept**          | One `.md` file with YAML frontmatter and a markdown body                   |
| **Concept ID**       | The file path without `.md` (e.g. `development/what-is-okf`)               |
| **Index**            | An `index.md` listing a directory's contents for progressive disclosure    |

## Minimal structure

Every concept file requires a `type` field in frontmatter. We use four project-specific types — see [OKF document taxonomy](/architecture/okf-document-taxonomy.md).

```yaml
---
type: guide
title: Example concept
description: One-line summary for indexes and search.
tags: [example]
---
```

The body is free-form markdown. Link between concepts with bundle-relative paths:

```markdown
See [OKF document taxonomy](/architecture/okf-document-taxonomy.md).
```

## Spec reference

- OKF specification (v0.2): https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
- Google Cloud announcement: https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing

## Related

- [OKF document taxonomy](/architecture/okf-document-taxonomy.md) — folder and type rules for this bundle
- See `AGENTS.md` at the repository root.
