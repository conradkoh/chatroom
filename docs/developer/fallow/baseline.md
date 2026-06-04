# Fallow Baseline

This document records the initial fallow findings when the tool replaced knip. Downstream projects should use these findings as a reference to understand which files/dependencies are intentionally unused and should not be fixed in one pass.

**Baseline generated:** 2026-06-03

## Machine-readable baseline

Committed at [`.fallow/baseline.json`](../../../.fallow/baseline.json). `pnpm find-deadcode` compares against it and only fails when **new** dead-code issues are introduced.

To refresh the baseline after intentional cleanup:

```bash
pnpm exec fallow dead-code --save-baseline .fallow/baseline.json
```

## Unused files (3)

These files exist but are not reachable from any entry point. They may be placeholders, deprecated code, or loaded only via configuration.

Test files are excluded from analysis via `.fallowrc.jsonc`. ShadCN UI export noise is suppressed with `ignoreExports` only (UI stays in the import graph).

```
apps/webapp/src/components/DateRangePicker.tsx
apps/webapp/src/components/ThemeToggle.tsx
apps/webapp/src/modules/checklist/checklist-empty-state.tsx
```

## Scripts

| Script             | Command                                                   | Purpose                                        |
| ------------------ | --------------------------------------------------------- | ---------------------------------------------- |
| `find-deadcode`    | `fallow dead-code --baseline .fallow/baseline.json`       | Dead code + deps; fails only on regressions    |
| `audit`            | `fallow audit --dead-code-baseline .fallow/baseline.json` | Changed-file review (also runs in pre-commit)  |
| `code-quality`     | `fallow`                                                  | Full analysis: dead code, duplication, health  |
| `code-quality:fix` | `fallow fix --dry-run`                                    | Preview automatic cleanup of dead exports/deps |

Pre-commit (`.husky/pre-commit`) runs `fallow audit` after lint-staged. It compares against the upstream merge-base (or `master`) and fails only on **new** issues (`audit.gate: new-only`), with dead-code checked against `.fallow/baseline.json`.

## Configuration

- [`.fallowrc.jsonc`](../../../.fallowrc.jsonc) — migrated from `knip.jsonc`
- `ignoreDependencies`: dev tooling (husky, lint-staged, ESLint stack, MDX/Next config packages, test runners, planned deps like `@hookform/resolvers`)
- `ignorePatterns`: test files, `**/_generated/**`, Next/ESLint/Playwright config files
- `ignoreExports`: all exports under `**/components/ui/**` (ShadCN composition primitives and duplicate-export barrels)
- `ignoreUnresolvedImports`: Convex generated `.js` re-exports and `**/convex/_generated/**`
- `ignoreExportsUsedInFile`: type/interface exports only used in the same file
- `duplicates.ignore` / `health.ignore`: same UI and test globs for `pnpm code-quality`

Fallow auto-discovers workspace packages from `pnpm-workspace.yaml` (`apps/*`, `services/*`).

## Notes

- Exit code 0 from `pnpm find-deadcode` means no **new** issues vs the baseline.
- Run `pnpm code-quality` for duplication (`dupes`) and complexity (`health`) checks that knip did not provide.
- Unresolved imports in `services/backend/convex/_generated/` are from Convex-generated files and may be expected.
