/** One verification kind a builder brief flags and a builder hand-back reports. */
export interface VerificationKind {
  /** Stable identifier. */
  readonly id: 'typecheck' | 'lint' | 'unit' | 'integration' | 'e2e';
  /** Name in the flag and result lines, e.g. `unit tests`. */
  readonly label: string;
  /** Name in the timing report row, e.g. `Unit tests`. */
  readonly timingLabel: string;
  /** Lightweight kinds always run: a brief never marks them `not applicable`, and a hand-back never records them as `not run`. */
  readonly lightweight: boolean;
  /** Command the brief author copies into the flag line. */
  readonly command: string;
  /** Optional extra sentence appended to the flag line. */
  readonly note?: string;
}

/** Verification kinds in report order. Derive every kind line from this list; do not hand-type kind names in templates. */
export const VERIFICATION_KINDS: readonly VerificationKind[] = [
  {
    id: 'typecheck',
    label: 'typecheck',
    timingLabel: 'Typecheck',
    lightweight: true,
    command: 'pnpm turbo run typecheck --filter=<package>',
  },
  {
    id: 'lint',
    label: 'lint',
    timingLabel: 'Lint',
    lightweight: true,
    command: 'pnpm exec eslint <files in scope>',
  },
  {
    id: 'unit',
    label: 'unit tests',
    timingLabel: 'Unit tests',
    lightweight: false,
    command: 'pnpm --dir <workspace> exec vitest run <test files in scope>',
  },
  {
    id: 'integration',
    label: 'integration tests',
    timingLabel: 'Integration tests',
    lightweight: false,
    command: 'pnpm --dir <workspace> exec vitest run <integration specs in scope>',
    note: 'The chatroom-cli suite is `pnpm --filter chatroom-cli test:integration`.',
  },
  {
    id: 'e2e',
    label: 'e2e',
    timingLabel: 'E2E',
    lightweight: false,
    command:
      'pnpm --dir apps/webapp exec playwright test --config=tests/e2e/playwright.config.ts <specs in scope> --project=chromium',
  },
];
