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
  /** Placeholder command the brief author replaces with the command from the target repository's package scripts or agent guidance files. */
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
    command: '<typecheck command>',
  },
  {
    id: 'lint',
    label: 'lint',
    timingLabel: 'Lint',
    lightweight: true,
    command: '<lint command>',
  },
  {
    id: 'unit',
    label: 'unit tests',
    timingLabel: 'Unit tests',
    lightweight: false,
    command: '<unit test command> <test files in scope>',
  },
  {
    id: 'integration',
    label: 'integration tests',
    timingLabel: 'Integration tests',
    lightweight: false,
    command: '<integration test command> <integration specs in scope>',
  },
  {
    id: 'e2e',
    label: 'e2e',
    timingLabel: 'E2E',
    lightweight: false,
    command: '<e2e test command> <specs in scope>',
  },
];
