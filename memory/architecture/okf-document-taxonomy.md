---
type: guide
title: OKF document taxonomy
description: Strict folder and document-type rules for the memory bundle.
tags: [okf, taxonomy, conventions]
status: stable
---

# OKF document taxonomy

This repository's agent memory lives in the `memory/` OKF bundle. To keep the corpus navigable and machine-filterable, only the folders and document types below are permitted.

## Allowed folders

Every concept file MUST live in exactly one of these top-level directories under `memory/`:

| Folder          | Purpose                                                        |
| --------------- | -------------------------------------------------------------- |
| `architecture/` | System design, structural decisions, cross-cutting conventions |
| `product/`      | Product requirements, features, user-facing behavior           |
| `testing/`      | Test strategy, coverage, and quality practices                 |
| `development/`  | Developer workflows, tooling, and how-to guides                |

No other top-level folders may be created under `memory/`.

## Allowed document types

Every concept file MUST set `type` in YAML frontmatter to exactly one of:

| Type            | Use when                                              |
| --------------- | ----------------------------------------------------- |
| `decision-log`  | Recording a decision, its context, and consequences   |
| `best-practice` | Recommended patterns the team should follow           |
| `guide`         | How-to instructions or explanatory reference material |
| `tech-debt`     | Known debt, tradeoffs accepted, and remediation notes |

## File rules

1. One concept per `.md` file (OKF concept document).
2. Reserved filenames `index.md` and `log.md` follow OKF spec semantics; do not use them for concepts.
3. Use kebab-case filenames (e.g. `auth-session-helpers.md`).
4. Cross-link with bundle-relative paths beginning with `/` (e.g. `/development/what-is-okf.md`).
5. Update the parent directory's `index.md` when adding a new concept.

## Examples

```
memory/
  architecture/
    okf-document-taxonomy.md    # type: guide
    convex-data-model.md        # type: decision-log  (future)
  development/
    what-is-okf.md              # type: guide
  product/
    invite-waitlist.md          # type: guide  (future)
  testing/
    e2e-conventions.md          # type: best-practice  (future)
```
