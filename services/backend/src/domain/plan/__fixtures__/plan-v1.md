# Add plan messages to the chatroom

## Sources

- jd7273e5rtyssejd198vkssnhx8jse03

## Requirements

- Publish a validated plan message that renders without collapsing.
- Keep existing message types unchanged.

## Constraints

- None.

## Phases

- P1 — Schema and parser
- P2 — Backend write and read path
- P3 — Timeline rendering

## Phase details

### P1 — Schema and parser

#### Requirements

- Add the plan literal to both message type unions.
- Headings inside fenced blocks are ignored:
  ```markdown
  ## Not a section
  ```

#### Constraints

- None.

#### Acceptance criteria

- A valid plan parses without errors.
- Every error code has a failing fixture.

### P2 — Backend write and read path

#### Depends on

- P1

#### Requirements

- Publish stores a validated plan message.
- Read returns the stored content.

#### Constraints

- No chatroom lastActivityAt patch.

#### Acceptance criteria

- Publishing an invalid plan stores nothing.

### P3 — Timeline rendering

#### Depends on

- P1

#### Requirements

- The plan row never collapses.

#### Constraints

- None.

#### Acceptance criteria

- A plan between two handoffs renders expanded.

## Remarks

The plan row renders title, phases, and per-phase details.
