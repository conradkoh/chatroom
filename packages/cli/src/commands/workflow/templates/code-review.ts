/**
 * Code Review Workflow Template
 *
 * Produces an 8-step sequential workflow where each step corresponds
 * to one of the eight code review pillars. The planner sees only one
 * step at a time and marks each complete before the next is revealed.
 */

import type { WorkflowTemplate } from './types';

const REVIEW_REQUIREMENTS =
  'Review the code against this pillar. Mark this step complete when you have finished reviewing and noting all findings for this pillar.';

export function getCodeReviewTemplate(role: string): WorkflowTemplate {
  return {
    key: 'code-review',
    steps: [
      {
        stepKey: 'pillar-1-simplification',
        description:
          'Simplification: functions/classes, dead code, monolithic patterns',
        dependsOn: [],
        order: 1,
        assigneeRole: role,
        specification: {
          goal: `## Pillar 1 — Simplification (Highest Priority)

AI generates more code than needed. The average developer checked in 75% more code in 2025
than in 2022 — volume that the team now has to maintain. AI agents never suggest refactoring,
so complexity accumulates silently.

Look for:
- Functions over ~40 lines or classes over ~200 lines with no clear single responsibility
- Monolithic architecture: 40–50% of AI code defaults to tightly-coupled structures that
  reverse a decade of modular progress (OX Security, 2025)
- Phantom Bugs: logic handling highly improbable edge cases, adding complexity with no benefit
  (found in 20–30% of AI code)
- Dead code, unused imports, or leftover scaffolding from generation
- PRs that touch services, libraries, infrastructure, and tests in a single change

Ask: Is there a simpler path to the same outcome? Would a new team member understand this
without help? Can this function be split without losing meaning?

Action: Flag any function over ~40 lines. Require decomposition or written justification
before merge.`,
          requirements: REVIEW_REQUIREMENTS,
        },
      },
      {
        stepKey: 'pillar-2-type-drift',
        description:
          'Type Drift: any usage, unsafe assertions, null checks, boundary drift',
        dependsOn: ['pillar-1-simplification'],
        order: 2,
        assigneeRole: role,
        specification: {
          goal: `## Pillar 2 — Type Drift (High Priority)

AI generates code in isolation from the broader type system. Type inconsistencies introduced
here surface later as null pointer exceptions, silent failures, and cross-service contract
mismatches. A University of Naples study of 500k+ samples (Aug 2025) confirmed these are the
most reliably catchable issues via static analysis — meaning they should never reach review.

Look for:
- \`any\` usage: defeats TypeScript entirely; AI reaches for it when uncertain
- Unsafe \`as\` assertions: suppresses the compiler rather than satisfying it
- Missing \`strictNullChecks\` compliance — null/undefined slipping through unchecked
- Boundary drift: API endpoints returning different shapes across execution paths
- Configuration drift: divergent \`tsconfig\` settings or ESLint rules added incrementally
- Leaked internals: AI exposing implementation details that should be encapsulated

Ask: Are all return types and parameters explicitly typed? Are API contract types shared and
stable? Does this match existing type conventions, or introduce a new pattern?

Action: \`strict: true\` in \`tsconfig.json\` is a hard gate. Any PR disabling strict settings
requires explicit team sign-off.`,
          requirements: REVIEW_REQUIREMENTS,
        },
      },
      {
        stepKey: 'pillar-3-duplication',
        description:
          'Duplication: shared abstractions, copy-paste, vanilla rebuilds',
        dependsOn: ['pillar-2-type-drift'],
        order: 3,
        assigneeRole: role,
        specification: {
          goal: `## Pillar 3 — Duplication (High Priority)

GitClear's 2025 analysis of 211 million changed lines found duplicated code blocks grew 8x
in one year, and copy/pasted code surpassed refactored code for the first time in history.
OX Security found "Bugs Déjà-Vu" in 70–80% of AI codebases: identical bugs recurring in
multiple locations because logic was never abstracted.

Look for:
- Duplicate utility logic across files — each instance works, but no shared abstraction exists
- "Vanilla Style" rebuilds: AI reconstructing functionality from scratch instead of using
  existing libraries, SDKs, or internal utilities (40–50% of AI code, OX Security)
- Duplicated validation, auth checks, and input sanitization
- Copy-pasted try/catch blocks instead of centralised error handling
- New dependencies that the existing codebase already covers

Ask: Does an equivalent utility already exist? Is this logic duplicated anywhere else?
Use AST-level search, not just grep.

Action: Require a codebase search before approving any new utility function. Run SonarQube,
CodeClimate, or Codacy as a PR gate for duplication thresholds.`,
          requirements: REVIEW_REQUIREMENTS,
        },
      },
      {
        stepKey: 'pillar-4-design-patterns',
        description:
          'Design Patterns: SOLID compliance, pattern violations, context blindness',
        dependsOn: ['pillar-3-duplication'],
        order: 4,
        assigneeRole: role,
        specification: {
          goal: `## Pillar 4 — Design Pattern Compliance (Standard Priority)

AI implements the prompt. It does not check the ADR log, existing service patterns, or
architectural conventions. OX Security identified "By-The-Book Fixation" in 80–90% of AI
code: rigid application of generic best practices, missing the better solution for this
specific context.

Look for:
- Pattern violations: raw \`fetch\` where an API service layer exists; new state patterns where
  a store convention is already established
- SOLID violations:
  - Single Responsibility: see Pillar 1
  - Open/Closed: code requiring modification rather than extension to add new behaviour
  - Dependency Inversion: hard-coded dependencies instead of injection
- No refactoring suggestions — AI never proposes that a feature should trigger a refactor
- Context blindness: ignoring ADRs, versioning strategy, or team-level conventions

Ask: Does this follow the patterns in this area of the codebase? Can this be extended without
modification? Are dependencies injected?

Action: Maintain a living \`ARCHITECTURE.md\` or ADR log. Pass it as context to AI tools before
generation, not after.`,
          requirements: REVIEW_REQUIREMENTS,
        },
      },
      {
        stepKey: 'pillar-5-security',
        description:
          'Security: OWASP Top 10, auth checks, secrets, env awareness',
        dependsOn: ['pillar-4-design-patterns'],
        order: 5,
        assigneeRole: role,
        specification: {
          goal: `## Pillar 5 — Security (Standard Priority)

45% of AI-generated code samples introduced OWASP Top 10 vulnerabilities in Veracode's 2025
test of 100+ LLMs. CodeRabbit found AI code is 2.74x more likely to introduce XSS, 1.88x more
likely to mishandle passwords, 1.82x more likely to implement insecure deserialization.
OX Security calls this "insecure by dumbness" — not malicious, but structurally blind to
security requirements that were not in the prompt.

Look for:
- OWASP Top 10: injection (SQL, XSS, command), broken auth, insecure deserialization
- "Worked on My Machine" syndrome (60–70% of AI code): missing environment awareness,
  hard-coded localhost references, assumed-present secrets
- Missing auth/ownership checks — AI assumes the happy path; role gates rarely appear unprompted
- Secrets, tokens, or credentials in source code
- Deprecated API patterns from the model's training data
- Excessive I/O (~8x human rate) and concurrency misuse (~2x human rate)

Ask: Are all inputs validated before use? Are auth checks present at every trust boundary?
Does this code behave differently across environments?

Action: Run SAST tooling (Snyk, Semgrep, SonarQube) on every AI-generated PR as a CI gate.
Manual review alone cannot keep pace with AI generation velocity.`,
          requirements: REVIEW_REQUIREMENTS,
        },
      },
      {
        stepKey: 'pillar-6-test-quality',
        description:
          'Test Quality: edge cases, coverage theater, integration tests',
        dependsOn: ['pillar-5-security'],
        order: 6,
        assigneeRole: role,
        specification: {
          goal: `## Pillar 6 — Test Quality (Standard Priority)

AI generates tests that look comprehensive but frequently are not. OX Security found "Fake
Test Coverage" in 40–50% of AI codebases: inflated metrics, low signal. The failure mode is
precise: AI tests its own assumptions, not the developer's intent. University of Naples (2025)
confirmed that even code passing all functional benchmarks averaged 1.45–1.77 static issues
per task.

Look for:
- Tests that verify AI output is stable, not that it is correct by domain rules
- Missing edge cases: empty inputs, boundary values, null handling, race conditions,
  business-rule violations
- Coverage theater: tests that assert no exception was thrown and nothing more
- No integration or contract tests — AI generates unit tests almost exclusively
- Tests coupled to implementation: must be updated every time the code changes

Ask: Do these tests verify the domain intent? Would they catch a logic regression in the
next PR? Are cross-service interactions tested?

Action: Test review is a separate pass from code review. Use mutation testing (Stryker,
PITest) to validate whether tests catch real defects — coverage percentage is not sufficient.`,
          requirements: REVIEW_REQUIREMENTS,
        },
      },
      {
        stepKey: 'pillar-7-ownership',
        description:
          'Ownership & Observability: named owner, logging, error handling, health checks',
        dependsOn: ['pillar-6-test-quality'],
        order: 7,
        assigneeRole: role,
        specification: {
          goal: `## Pillar 7 — Ownership, Observability, Deployment (Standard Priority)

The most consistently missed category. ISACA's 2026 incident review found that the biggest
AI failures of 2025 were organisational, not technical: weak controls and unclear ownership.
Bright Security (2026) identified unclear ownership as one of the most dangerous patterns:
code that works well enough that no one feels responsible for it. IBM's 2025 breach data found
shadow AI added $670,000 average to breach costs.

Look for:
- No named human owner — every AI-generated module needs someone who can explain it in a
  postmortem without reading it fresh
- Missing structured logs, metrics emission, or tracing hooks
- Swallowed exceptions: retry logic with no alerting; fallback paths invisible to operators
- No environment-specific configuration, secrets management, or health check endpoints
- Model versioning chaos: inconsistencies from team members using different AI tool versions
- Shadow AI: code with no record of which tool or prompt produced it

Ask: Who owns this? Will production failures surface to operators? Does this behave
differently across environments?

Action: Require every AI-generated module to have a named owner in CODEOWNERS. Add logging
requirements to the PR template. Establish a team AI governance policy that tracks tools
and model versions — treat this like any other dependency.`,
          requirements: REVIEW_REQUIREMENTS,
        },
      },
      {
        stepKey: 'pillar-8-dead-code',
        description:
          'Dead Code: unreachable code, unused imports, orphaned config',
        dependsOn: ['pillar-7-ownership'],
        order: 8,
        assigneeRole: role,
        specification: {
          goal: `## Pillar 8 — Dead Code Elimination (Standard Priority)

AI generates code speculatively. It adds helper functions "just in case", creates abstractions
for paths that never materialise, and leaves behind scaffolding from earlier generation
attempts. GitClear's 2025 data showed a 75% increase in total code volume, much of it never
executed. Dead code is not harmless — it misleads future readers, inflates bundle sizes, creates
false positive search results, and adds surface area for bugs and security vulnerabilities
in code that serves no purpose.

Look for:
- Unreachable code: functions, methods, or branches that no call site ever invokes
- Unused imports: modules imported but never referenced — common in AI-generated files
- Commented-out code: old implementations left inline instead of being removed; version
  control already preserves history
- Feature flags that are permanently off: conditional paths that were never enabled or have
  been superseded but not cleaned up
- Orphaned configuration: environment variables, constants, or config entries with no consumer
- Stale types and interfaces: type definitions for data shapes that no longer exist in the
  system
- Unused dependencies: packages listed in \`package.json\` (or equivalent) that no source file
  imports
- Vestigial error handling: catch blocks or fallback paths for conditions that can no longer
  occur due to upstream changes
- Test helpers and fixtures for tests that have been deleted

Ask: Is every function called? Is every import used? Is every dependency exercised?
Would removing this code change any observable behaviour?

Action: Run tree-shaking analysis and dead code detection tools (e.g., \`ts-prune\`,
\`knip\`, \`depcheck\`, IDE unused-symbol highlighting) as part of CI. Treat dead code
the same as duplication — it compounds over time and must be actively managed.`,
          requirements: REVIEW_REQUIREMENTS,
        },
      },
    ],
  };
}
