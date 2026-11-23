/**
 * Parse Plan
 *
 * Pure parser for the `type: 'plan'` message markdown (see
 * `plan-template-spec.ts`). Every consumer — the backend write path, the CLI
 * reader, future prompts — calls this function rather than re-implementing the
 * template rules.
 *
 * Contract:
 * - Never throws. Malformed input always returns `{ ok: false, errors }`.
 * - Reports *all* errors in a single pass, each with a 1-based line number.
 * - Errors are sorted by line asc, then code asc, so output is deterministic.
 * - Headings and bullets inside fenced code blocks (``` or ~~~) are content.
 * - A code fence must be closed by a bare run of the same character at least as
 *   long as its opener; an unclosed fence is `PLAN_FENCE_UNCLOSED` at its
 *   opening line.
 * - Unindented text after a blank line is `PLAN_STRAY_CONTENT`; indented text
 *   after a blank line still continues the bullet above.
 * - Headings start in column 1; indented `#` text is bullet continuation.
 * - `None.` is honoured only for `Sources`, `Constraints`, per-phase
 *   `Constraints`, and per-phase `Depends on`; anywhere else it is an error.
 */

import {
  PLAN_HEADINGS,
  PLAN_MAX_CHARS,
  PLAN_MAX_PHASES,
  PLAN_NONE_ALLOWED_PHASE_SECTIONS,
  PLAN_NONE_ALLOWED_SECTIONS,
  PLAN_NONE_TOKEN,
  PLAN_PHASE_ID_PATTERN,
  PLAN_PHASE_SECTION_NAMES,
  PLAN_PHASE_SECTION_ORDER,
  PLAN_REQUIRED_SECTIONS,
  PLAN_SECTION_NAMES,
  PLAN_SECTION_ORDER,
  type PlanParseErrorCode,
  type PlanPhaseSectionName,
  type PlanSectionName,
} from './plan-template-spec';

export interface ParsedPhase {
  id: string;
  title: string;
  dependsOn: string[];
  requirements: string[];
  constraints: string[];
  acceptance: string[];
}
export interface ParsedPlan {
  title: string;
  sources: string[];
  requirements: string[];
  constraints: string[];
  phases: ParsedPhase[];
  remarks: string | null;
}
export interface PlanParseError {
  code: PlanParseErrorCode;
  line: number;
  message: string;
}
export type ParsePlanResult =
  { ok: true; plan: ParsedPlan } | { ok: false; errors: PlanParseError[] };

interface Bullet {
  text: string;
  line: number;
}
interface PhaseBlock {
  id: string;
  title: string;
  line: number;
  lastSectionRank: number;
  sections: Map<PlanPhaseSectionName, Bullet[]>;
}

/** Mutable state accumulated by the single document scan. */
interface ParseState {
  errors: PlanParseError[];
  title: string | null;
  firstContentSeen: boolean;
  lastSectionRank: number;
  currentSection: PlanSectionName | null;
  currentPhase: PhaseBlock | null;
  currentPhaseSection: PlanPhaseSectionName | null;
  currentBullet: Bullet | null;
  orphanReported: boolean;
  sectionHeadings: Map<PlanSectionName, number>;
  sectionBullets: Map<PlanSectionName, Bullet[]>;
  remarksLines: string[];
  phaseListBullets: Bullet[];
  phaseBlocks: PhaseBlock[];
  /** Previous physical line was blank (scan-loop context). */
  blankBefore: boolean;
  /** This line was inside an already-open fence: body or closer (scan-loop context). */
  insideFence: boolean;
}

interface ListedPhase {
  id: string;
  title: string;
  line: number;
}

const PHASE_ENTRY_PATTERN = /^P([1-9]\d*)\s+[—–-]\s+(.+)$/;
const TITLE_PATTERN = /^#\s+(.+)$/;
const STRAY_CONTENT_MESSAGE =
  'Unindented text after a blank line is not part of the bullet above; indent it under the bullet or start a new "- " item';

interface FenceState {
  inFence: boolean;
  /** Character that opened the fence (` or ~); null while no fence is open. */
  fenceChar: string | null;
  /** Length of the opening run; a closer must be at least this long. */
  fenceLength: number;
  /** 1-based line of the opening delimiter; meaningful while `inFence` is true. */
  openedAt: number;
}

/** Context for one bullet list; drives `None.` policy and messages. */
interface ListContext {
  /** e.g. `"Requirements"` or `"P1" Depends on`. */
  label: string;
  /** Code reported when `- None.` appears in a section that forbids it. */
  noneCode: PlanParseErrorCode;
  noneAllowed: boolean;
}

type HeadingHandler = (state: ParseState, text: string, line: number) => void;

/** Trim a fully-assembled bullet: drop trailing whitespace/newlines only. */
function trimItem(text: string): string {
  return text.replace(/\s+$/, '');
}

function isNoneToken(text: string): boolean {
  return text.trim().toLowerCase() === PLAN_NONE_TOKEN.toLowerCase();
}

function parsePhaseEntry(text: string): { id: string; title: string } | null {
  const match = PHASE_ENTRY_PATTERN.exec(text.trim());
  if (!match) return null;
  const title = match[2].trim();
  return title.length > 0 ? { id: `P${match[1]}`, title } : null;
}

function lookupSectionName(raw: string): PlanSectionName | null {
  const needle = raw.trim().toLowerCase();
  for (const key of Object.keys(PLAN_SECTION_NAMES) as PlanSectionName[]) {
    if (PLAN_SECTION_NAMES[key].toLowerCase() === needle) return key;
  }
  return null;
}

function lookupPhaseSectionName(raw: string): PlanPhaseSectionName | null {
  const needle = raw.trim().toLowerCase();
  for (const key of Object.keys(PLAN_PHASE_SECTION_NAMES) as PlanPhaseSectionName[]) {
    if (PLAN_PHASE_SECTION_NAMES[key].toLowerCase() === needle) return key;
  }
  return null;
}

function phaseNumber(id: string): number {
  return Number.parseInt(id.slice(1), 10);
}

function createState(errors: PlanParseError[]): ParseState {
  return {
    errors,
    title: null,
    firstContentSeen: false,
    lastSectionRank: -1,
    currentSection: null,
    currentPhase: null,
    currentPhaseSection: null,
    currentBullet: null,
    orphanReported: false,
    sectionHeadings: new Map(),
    sectionBullets: new Map(),
    remarksLines: [],
    phaseListBullets: [],
    phaseBlocks: [],
    blankBefore: false,
    insideFence: false,
  };
}

function record(state: ParseState, code: PlanParseErrorCode, line: number, message: string): void {
  state.errors.push({ code, line, message });
}

/**
 * Content no bullet can take. Inside a recognised section it is a stray
 * paragraph; outside every section it is an orphan. Reported once per section.
 */
function reportOrphan(state: ParseState, line: number): void {
  if (state.orphanReported) return;
  state.orphanReported = true;
  if (state.currentSection !== null) {
    record(state, 'PLAN_STRAY_CONTENT', line, STRAY_CONTENT_MESSAGE);
    return;
  }
  record(state, 'PLAN_SECTION_ORDER', line, 'Content appears outside any recognised plan section');
}

function listedPhaseIds(state: ParseState): Set<string> {
  return new Set(
    state.phaseListBullets
      .map((bullet) => parsePhaseEntry(trimItem(bullet.text)))
      .filter((parsed): parsed is { id: string; title: string } => parsed !== null)
      .map((parsed) => parsed.id)
  );
}

function appendBullet(state: ParseState, target: Bullet[], raw: string, line: number): void {
  const bullet: Bullet = { text: raw.slice(2), line };
  target.push(bullet);
  state.currentBullet = bullet;
}

function handlePlanSectionHeading(state: ParseState, text: string, line: number): void {
  state.currentBullet = null;
  state.currentPhase = null;
  state.currentPhaseSection = null;
  state.orphanReported = false;

  const name = lookupSectionName(text);
  if (!name) {
    record(state, 'PLAN_SECTION_ORDER', line, `Unrecognised section heading "## ${text.trim()}"`);
    state.currentSection = null;
    return;
  }
  if (state.sectionHeadings.has(name)) {
    record(
      state,
      'PLAN_SECTION_ORDER',
      line,
      `Duplicate section heading "## ${PLAN_SECTION_NAMES[name]}"`
    );
    state.currentSection = null;
    return;
  }
  const rank = PLAN_SECTION_ORDER.indexOf(name);
  if (rank <= state.lastSectionRank) {
    record(
      state,
      'PLAN_SECTION_ORDER',
      line,
      `Section heading "## ${PLAN_SECTION_NAMES[name]}" is out of order`
    );
    state.currentSection = null;
    return;
  }
  state.sectionHeadings.set(name, line);
  state.lastSectionRank = rank;
  state.currentSection = name;
}

/** True when the heading may open a phase detail block; reports why not. */
function checkPhaseEntryListed(state: ParseState, entry: { id: string }, line: number): boolean {
  if (state.phaseBlocks.some((block) => block.id === entry.id)) {
    record(state, 'PLAN_PHASE_DETAIL_UNLISTED', line, `Duplicate phase detail block "${entry.id}"`);
    return false;
  }
  if (!listedPhaseIds(state).has(entry.id)) {
    record(
      state,
      'PLAN_PHASE_DETAIL_UNLISTED',
      line,
      `Phase detail "${entry.id}" is not listed in "## Phases"`
    );
    return false;
  }
  return true;
}

/** Parse and validate a `### Pn — title` heading; null when it cannot open a block. */
function resolvePhaseHeadingEntry(
  state: ParseState,
  heading: string,
  line: number
): { id: string; title: string } | null {
  if (state.currentSection !== 'phaseDetails') {
    record(
      state,
      'PLAN_SECTION_ORDER',
      line,
      'Phase detail headings are only valid inside "## Phase details"'
    );
    return null;
  }
  const entry = parsePhaseEntry(heading);
  if (!entry) {
    record(
      state,
      'PLAN_PHASE_DETAIL_UNLISTED',
      line,
      `Phase detail heading "${heading}" must look like "P1 — <title>"`
    );
    return null;
  }
  return checkPhaseEntryListed(state, entry, line) ? entry : null;
}

function pushPhaseBlock(
  state: ParseState,
  entry: { id: string; title: string },
  line: number
): PhaseBlock {
  const block: PhaseBlock = {
    id: entry.id,
    title: entry.title,
    line,
    lastSectionRank: -1,
    sections: new Map(),
  };
  state.phaseBlocks.push(block);
  return block;
}

function handlePhaseHeading(state: ParseState, heading: string, line: number): void {
  state.currentBullet = null;
  state.currentPhaseSection = null;
  state.orphanReported = false;

  const entry = resolvePhaseHeadingEntry(state, heading, line);
  state.currentPhase = entry === null ? null : pushPhaseBlock(state, entry, line);
}

function isInsidePhaseBlock(state: ParseState, phase: PhaseBlock | null): phase is PhaseBlock {
  return state.currentSection === 'phaseDetails' && phase !== null;
}

/** Open a phase sub-section; reports duplicate/out-of-order headings. */
function openPhaseSection(
  state: ParseState,
  phase: PhaseBlock,
  name: PlanPhaseSectionName,
  line: number
): PlanPhaseSectionName | null {
  if (phase.sections.has(name)) {
    record(
      state,
      'PLAN_SECTION_ORDER',
      line,
      `Duplicate phase sub-section "${PLAN_PHASE_SECTION_NAMES[name]}"`
    );
    return null;
  }
  const rank = PLAN_PHASE_SECTION_ORDER.indexOf(name);
  if (rank <= phase.lastSectionRank) {
    record(
      state,
      'PLAN_SECTION_ORDER',
      line,
      `Phase sub-section "${PLAN_PHASE_SECTION_NAMES[name]}" is out of order`
    );
    return null;
  }
  phase.lastSectionRank = rank;
  phase.sections.set(name, []);
  return name;
}

function handlePhaseSectionHeading(state: ParseState, text: string, line: number): void {
  state.currentBullet = null;

  const phase = state.currentPhase;
  if (!isInsidePhaseBlock(state, phase)) {
    record(
      state,
      'PLAN_SECTION_ORDER',
      line,
      'Phase sub-section headings are only valid inside a "### Pn" block'
    );
    state.orphanReported = false;
    return;
  }
  const name = lookupPhaseSectionName(text);
  if (name === null) {
    record(
      state,
      'PLAN_SECTION_ORDER',
      line,
      `Unrecognised phase sub-section "#### ${text.trim()}"`
    );
    state.orphanReported = false;
    return;
  }
  state.currentPhaseSection = openPhaseSection(state, phase, name, line);
  state.orphanReported = false;
}

type TopLevelListSection = 'sources' | 'requirements' | 'constraints';

function isTopLevelListSection(section: PlanSectionName | null): section is TopLevelListSection {
  return section === 'sources' || section === 'requirements' || section === 'constraints';
}

/**
 * The bullet list the current line belongs to, creating it on first use.
 * Returns null when bullets are not allowed in the current position.
 */
function currentBulletList(state: ParseState): Bullet[] | null {
  if (isTopLevelListSection(state.currentSection)) {
    return sectionBulletList(state, state.currentSection);
  }

  const phase = state.currentPhase;
  const name = state.currentPhaseSection;
  if (phase === null) return null;
  if (name === null) return null;
  return phaseBulletList(phase, name);
}

/** Plan-level list for `## Sources` / `## Requirements` / `## Constraints`. */
function sectionBulletList(state: ParseState, name: TopLevelListSection): Bullet[] {
  const list = state.sectionBullets.get(name) ?? [];
  state.sectionBullets.set(name, list);
  return list;
}

/** Per-phase list for one phase sub-section. */
function phaseBulletList(phase: PhaseBlock, name: PlanPhaseSectionName): Bullet[] {
  const list = phase.sections.get(name) ?? [];
  phase.sections.set(name, list);
  return list;
}

function handleBulletLine(state: ParseState, raw: string, line: number): void {
  if (state.currentSection === 'remarks') {
    state.remarksLines.push(raw);
    return;
  }
  if (state.currentSection === 'phases') {
    state.phaseListBullets.push({ text: raw.slice(2), line });
    state.currentBullet = null;
    return;
  }
  const list = currentBulletList(state);
  if (list === null) {
    reportOrphan(state, line);
    return;
  }
  appendBullet(state, list, raw, line);
}

/** Append a continuation line to the current bullet, if any. */
function appendContinuation(state: ParseState, raw: string): boolean {
  if (state.currentBullet === null) return false;
  state.currentBullet.text += `\n${raw}`;
  return true;
}

function handleContentLine(state: ParseState, raw: string, trimmed: string, line: number): void {
  if (state.currentSection === 'remarks') return pushRemarkLine(state, raw);
  if (state.currentSection === 'phases') return recordPhaseListContentError(state, line);
  handleContentFallback(state, raw, trimmed, line);
}

/** Remarks keep their raw lines (including blank ones) verbatim. */
function pushRemarkLine(state: ParseState, raw: string): void {
  state.remarksLines.push(raw);
}

/** A `## Phases` list entry must stay one line; anything else is invalid. */
function recordPhaseListContentError(state: ParseState, line: number): void {
  record(
    state,
    'PLAN_PHASE_ID_INVALID',
    line,
    'Phase list entries must be a single line of the form "- P1 — <title>"'
  );
}

/** True when a bullet is open and the previous physical line was blank. */
function isBulletOpenAfterBlank(state: ParseState): boolean {
  return state.currentBullet !== null && state.blankBefore && !state.insideFence;
}

/** True for a non-empty line that starts in column 1 (no leading whitespace). */
function isUnindentedLine(raw: string, trimmed: string): boolean {
  return trimmed.length > 0 && !/^\s/.test(raw);
}

/**
 * Unindented text after a blank line cannot continue a bullet; the template's
 * sections accept only bullets, so it is rejected rather than attributed.
 */
function isStrayParagraph(state: ParseState, raw: string, trimmed: string): boolean {
  return isBulletOpenAfterBlank(state) && isUnindentedLine(raw, trimmed);
}

function recordStrayParagraph(state: ParseState, line: number): void {
  record(state, 'PLAN_STRAY_CONTENT', line, STRAY_CONTENT_MESSAGE);
  // Detached: never stored in a list. The rest of this paragraph (no blank line
  // between) keeps attaching here and is not reported again; a later
  // blank-separated paragraph still finds an open bullet and is reported.
  state.currentBullet = { text: '', line };
}

/** Continuation of the current bullet, else an orphan line. */
function handleContentFallback(
  state: ParseState,
  raw: string,
  trimmed: string,
  line: number
): void {
  if (isStrayParagraph(state, raw, trimmed)) return recordStrayParagraph(state, line);
  if (appendContinuation(state, raw)) return;
  if (trimmed.length > 0) reportOrphan(state, line);
}

/** A fence opener: a run of 3+ backticks or tildes at the start of the trimmed line. */
const FENCE_OPENER_PATTERN = /^(`{3,}|~{3,})/;
/** A fence closer: a trimmed line made of nothing but a run of 3+ backticks or tildes. */
const FENCE_CLOSER_PATTERN = /^(`{3,}|~{3,})$/;

/** True when a trimmed line is a bare closer for the open fence. */
function isFenceCloser(fence: FenceState, trimmed: string): boolean {
  const closer = FENCE_CLOSER_PATTERN.exec(trimmed);
  return (
    closer !== null && closer[1][0] === fence.fenceChar && closer[1].length >= fence.fenceLength
  );
}

/**
 * Advance the fence state for one trimmed line. Returns true when the line is
 * part of a fence (opener, body, or closer). A closer must use the opener's
 * character and be at least as long as the opener, so a 4-backtick fence may
 * contain ``` lines and a ```python line inside a fence is content.
 */
function isFenceLine(fence: FenceState, trimmed: string, line: number): boolean {
  if (!fence.inFence) {
    const opener = FENCE_OPENER_PATTERN.exec(trimmed);
    if (opener === null) return false;
    fence.inFence = true;
    fence.fenceChar = opener[1][0];
    fence.fenceLength = opener[1].length;
    fence.openedAt = line;
    return true;
  }
  if (isFenceCloser(fence, trimmed)) {
    fence.inFence = false;
    fence.fenceChar = null;
  }
  return true;
}

/** Consume a blank line; remarks keep their blank lines verbatim. */
function handleBlankLine(state: ParseState, raw: string, trimmed: string): boolean {
  if (trimmed.length > 0) return false;
  if (state.currentSection === 'remarks') state.remarksLines.push(raw);
  return true;
}

/**
 * Consume the document's first content line when it is the H1 title.
 * Returns false (after reporting `PLAN_TITLE_MISSING`) when it is not, so the
 * same line is still dispatched as content and produces its usual errors.
 */
function consumeTitleLine(state: ParseState, trimmed: string, line: number): boolean {
  if (state.firstContentSeen) return false;
  state.firstContentSeen = true;
  const titleMatch = TITLE_PATTERN.exec(trimmed);
  if (titleMatch) {
    state.title = titleMatch[1].trim();
    return true;
  }
  record(state, 'PLAN_TITLE_MISSING', line, 'The plan title must be an H1 on the first line');
  return false;
}

function handleExtraTitle(state: ParseState, _text: string, line: number): void {
  record(state, 'PLAN_SECTION_ORDER', line, 'Only one H1 (the plan title) is allowed');
}

/** Heading dispatchers keyed by prefix; the handler receives the text after it. */
const HEADING_HANDLERS: readonly { prefix: string; handle: HeadingHandler }[] = [
  { prefix: PLAN_HEADINGS.phaseSection, handle: handlePhaseSectionHeading },
  { prefix: PLAN_HEADINGS.phase, handle: handlePhaseHeading },
  { prefix: PLAN_HEADINGS.section, handle: handlePlanSectionHeading },
  { prefix: PLAN_HEADINGS.title, handle: handleExtraTitle },
];

function handleStructuredLine(state: ParseState, raw: string, trimmed: string, line: number): void {
  const heading = HEADING_HANDLERS.find((entry) => trimmed.startsWith(entry.prefix));
  if (heading) {
    heading.handle(state, trimmed.slice(heading.prefix.length), line);
    return;
  }
  if (raw.startsWith('- ')) {
    handleBulletLine(state, raw, line);
    return;
  }
  handleContentLine(state, raw, trimmed, line);
}

/** One fence-aware document line. */
function scanLine(state: ParseState, fence: FenceState, raw: string, line: number): void {
  const trimmed = raw.trim();
  state.insideFence = fence.inFence; // read before this line can open or close a fence

  if (isFenceLine(fence, trimmed, line)) {
    handleContentLine(state, raw, trimmed, line);
    return;
  }
  if (handleBlankLine(state, raw, trimmed)) return;
  if (consumeTitleLine(state, trimmed, line)) return;
  handleStructuredLine(state, raw, trimmed, line);
}

/** Single fence-aware pass over the document, populating `state`. */
function scanDocument(lines: string[], state: ParseState): void {
  const fence: FenceState = { inFence: false, fenceChar: null, fenceLength: 0, openedAt: 0 };
  for (let index = 0; index < lines.length; index++) {
    state.blankBefore = index > 0 && lines[index - 1].trim().length === 0;
    scanLine(state, fence, lines[index], index + 1);
  }
  if (fence.inFence) {
    record(
      state,
      'PLAN_FENCE_UNCLOSED',
      fence.openedAt,
      `Code fence opened on line ${fence.openedAt} is never closed`
    );
  }
}

/** Line of the first present section after `name`, used to anchor "missing" errors. */
function missingSectionLine(state: ParseState, name: PlanSectionName, fallback: number): number {
  const rank = PLAN_SECTION_ORDER.indexOf(name);
  for (let next = rank + 1; next < PLAN_SECTION_ORDER.length; next++) {
    const line = state.sectionHeadings.get(PLAN_SECTION_ORDER[next]);
    if (line !== undefined) return line;
  }
  return fallback;
}

function validateMissingSections(state: ParseState, lastLineNumber: number): void {
  for (const name of PLAN_REQUIRED_SECTIONS) {
    if (state.sectionHeadings.has(name)) continue;
    record(
      state,
      'PLAN_SECTION_MISSING',
      missingSectionLine(state, name, lastLineNumber),
      `Missing required section "## ${PLAN_SECTION_NAMES[name]}"`
    );
  }
}

function finaliseBullets(bullets: Bullet[]): Bullet[] {
  return bullets
    .map((bullet) => ({ ...bullet, text: trimItem(bullet.text) }))
    .filter((bullet) => bullet.text.trim().length > 0);
}

function finaliseBulletsInState(state: ParseState): void {
  for (const [name, bullets] of state.sectionBullets) {
    state.sectionBullets.set(name, finaliseBullets(bullets));
  }
  state.phaseListBullets = finaliseBullets(state.phaseListBullets);
  for (const block of state.phaseBlocks) {
    for (const [name, bullets] of block.sections) {
      block.sections.set(name, finaliseBullets(bullets));
    }
  }
}

/** Validate the `## Phases` list and return the sequentially valid entries. */
function collectPhaseList(state: ParseState): {
  listedEntries: ListedPhase[];
  listedIds: Set<string>;
} {
  const phasesHeading = state.sectionHeadings.get('phases');
  const phaseList = state.phaseListBullets.map((bullet) => ({
    bullet,
    entry: parsePhaseEntry(bullet.text),
  }));

  if (phasesHeading !== undefined && phaseList.length === 0) {
    record(
      state,
      'PLAN_PHASE_LIST_EMPTY',
      phasesHeading,
      'The "## Phases" section must list at least one phase'
    );
  }
  if (phaseList.length > PLAN_MAX_PHASES) {
    record(
      state,
      'PLAN_TOO_MANY_PHASES',
      phaseList[PLAN_MAX_PHASES].bullet.line,
      `A plan may declare at most ${PLAN_MAX_PHASES} phases`
    );
  }

  const listedEntries: ListedPhase[] = [];
  phaseList.forEach(({ bullet, entry }, index) => {
    const expectedId = `P${index + 1}`;
    if (!entry) {
      record(
        state,
        'PLAN_PHASE_ID_INVALID',
        bullet.line,
        `Phase entry "${bullet.text.trim()}" must look like "- Pn — <title>"`
      );
      return;
    }
    if (entry.id !== expectedId) {
      record(
        state,
        'PLAN_PHASE_ID_INVALID',
        bullet.line,
        `Phase ids must be sequential: expected "${expectedId}", got "${entry.id}"`
      );
      return;
    }
    listedEntries.push({ id: entry.id, title: entry.title, line: bullet.line });
  });

  return { listedEntries, listedIds: new Set(listedEntries.map((entry) => entry.id)) };
}

function readRemarks(state: ParseState): string | null {
  const heading = state.sectionHeadings.get('remarks');
  if (heading === undefined) return null;
  const raw = state.remarksLines.join('\n').trim();
  if (raw.length === 0) {
    record(state, 'PLAN_SECTION_EMPTY', heading, 'The "## Remarks" section must not be empty');
    return null;
  }
  return raw;
}

function planListContext(name: PlanSectionName): ListContext {
  return {
    label: `"${PLAN_SECTION_NAMES[name]}"`,
    noneCode: 'PLAN_SECTION_EMPTY',
    noneAllowed: PLAN_NONE_ALLOWED_SECTIONS.includes(name),
  };
}

function phaseListContext(block: PhaseBlock, name: PlanPhaseSectionName): ListContext {
  return {
    label: `"${block.id}" ${PLAN_PHASE_SECTION_NAMES[name]}`,
    noneCode: 'PLAN_PHASE_SECTION_MISSING',
    noneAllowed: PLAN_NONE_ALLOWED_PHASE_SECTIONS.includes(name),
  };
}

function firstNoneLine(bullets: Bullet[]): number | null {
  const none = bullets.find((bullet) => isNoneToken(bullet.text));
  return none === undefined ? null : none.line;
}

function reportNoneNotAllowed(
  state: ParseState,
  context: ListContext,
  bullets: Bullet[],
  line: number
): Bullet[] {
  record(state, context.noneCode, line, `"${PLAN_NONE_TOKEN}" is not allowed in ${context.label}`);
  return bullets.filter((bullet) => !isNoneToken(bullet.text));
}

function reportNoneMixed(
  state: ParseState,
  context: ListContext,
  bullets: Bullet[],
  line: number
): Bullet[] {
  record(
    state,
    'PLAN_SECTION_ORDER',
    line,
    `"${PLAN_NONE_TOKEN}" must be the only item in ${context.label}`
  );
  return bullets.filter((bullet) => !isNoneToken(bullet.text));
}

/**
 * Apply the `None.` policy to one bullet list. Shared by the plan-level and
 * per-phase readers so the two cannot drift.
 */
function readListItems(state: ParseState, bullets: Bullet[], context: ListContext): Bullet[] {
  const noneLine = firstNoneLine(bullets);
  if (noneLine === null) return bullets;
  if (!context.noneAllowed) return reportNoneNotAllowed(state, context, bullets, noneLine);
  if (bullets.length > 1) return reportNoneMixed(state, context, bullets, noneLine);
  return [];
}

function readPlanListSection(state: ParseState, name: PlanSectionName): string[] {
  const heading = state.sectionHeadings.get(name);
  if (heading === undefined) return [];
  const bullets = state.sectionBullets.get(name) ?? [];
  if (bullets.length === 0) {
    record(
      state,
      'PLAN_SECTION_EMPTY',
      heading,
      `The "## ${PLAN_SECTION_NAMES[name]}" section must not be empty`
    );
    return [];
  }
  return readListItems(state, bullets, planListContext(name)).map((bullet) => bullet.text);
}

function readPhaseSection(
  state: ParseState,
  block: PhaseBlock,
  name: PlanPhaseSectionName
): string[] {
  const bullets = block.sections.get(name) ?? [];
  if (bullets.length === 0) {
    record(
      state,
      'PLAN_PHASE_SECTION_MISSING',
      block.line,
      `Phase "${block.id}" is missing its "${PLAN_PHASE_SECTION_NAMES[name]}" sub-section`
    );
    return [];
  }
  return readListItems(state, bullets, phaseListContext(block, name)).map((bullet) => bullet.text);
}

/** True when `referenced` is a listed phase earlier than `current`. */
function isValidDependsOn(
  referenced: string | null,
  current: number,
  listedIds: Set<string>
): referenced is string {
  return referenced !== null && phaseNumber(referenced) < current && listedIds.has(referenced);
}

function validateDependsOnEntry(
  state: ParseState,
  block: PhaseBlock,
  listedIds: Set<string>,
  bullet: Bullet
): string | null {
  const text = bullet.text.trim();
  const match = PLAN_PHASE_ID_PATTERN.exec(text);
  const referenced = match ? `P${match[1]}` : null;
  if (isValidDependsOn(referenced, phaseNumber(block.id), listedIds)) return referenced;
  record(
    state,
    'PLAN_DEPENDS_ON_INVALID',
    bullet.line,
    `"${text}" must reference an earlier phase listed in "## Phases"`
  );
  return null;
}

function validateDependsOn(state: ParseState, block: PhaseBlock, listedIds: Set<string>): string[] {
  const bullets = block.sections.get('dependsOn') ?? [];
  const candidates = readListItems(state, bullets, phaseListContext(block, 'dependsOn'));
  const validated: string[] = [];
  for (const bullet of candidates) {
    const referenced = validateDependsOnEntry(state, block, listedIds, bullet);
    if (referenced !== null) validated.push(referenced);
  }
  return validated;
}

function validatePhaseDetail(
  state: ParseState,
  entry: ListedPhase,
  blocksById: Map<string, PhaseBlock>,
  phaseDetailsHeading: number
): void {
  const block = blocksById.get(entry.id);
  if (!block) {
    record(
      state,
      'PLAN_PHASE_DETAIL_MISSING',
      phaseDetailsHeading,
      `Missing "### ${entry.id} — ${entry.title}" block in "## Phase details"`
    );
    return;
  }
  if (block.title !== entry.title) {
    record(
      state,
      'PLAN_PHASE_TITLE_MISMATCH',
      block.line,
      `Phase "${entry.id}" title must match the list: expected "${entry.title}", got "${block.title}"`
    );
  }
}

function validatePhaseDetails(state: ParseState, listedEntries: ListedPhase[]): void {
  const heading = state.sectionHeadings.get('phaseDetails');
  if (heading === undefined) return;
  const blocksById = new Map(state.phaseBlocks.map((block) => [block.id, block]));
  for (const entry of listedEntries) validatePhaseDetail(state, entry, blocksById, heading);
}

function buildParsedPhases(
  state: ParseState,
  listedEntries: ListedPhase[],
  listedIds: Set<string>
): ParsedPhase[] {
  const blocksById = new Map(state.phaseBlocks.map((block) => [block.id, block]));
  return listedEntries.map((entry) => {
    const block = blocksById.get(entry.id);
    if (!block) {
      return {
        id: entry.id,
        title: entry.title,
        dependsOn: [],
        requirements: [],
        constraints: [],
        acceptance: [],
      };
    }
    return {
      id: block.id,
      title: block.title,
      dependsOn: validateDependsOn(state, block, listedIds),
      requirements: readPhaseSection(state, block, 'requirements'),
      constraints: readPhaseSection(state, block, 'constraints'),
      acceptance: readPhaseSection(state, block, 'acceptance'),
    };
  });
}

function recordLengthError(state: ParseState, markdown: string): void {
  if (markdown.length <= PLAN_MAX_CHARS) return;
  record(
    state,
    'PLAN_TOO_LONG',
    1,
    `Plan must be ${PLAN_MAX_CHARS} characters or less (got ${markdown.length})`
  );
}

function recordEmptyDocumentError(state: ParseState): void {
  if (state.firstContentSeen) return;
  record(state, 'PLAN_TITLE_MISSING', 1, 'The plan title must be an H1 on the first line');
}

function buildParsedPlan(
  state: ParseState,
  listedEntries: ListedPhase[],
  listedIds: Set<string>
): ParsedPlan {
  validatePhaseDetails(state, listedEntries);
  return {
    title: state.title ?? '',
    sources: readPlanListSection(state, 'sources'),
    requirements: readPlanListSection(state, 'requirements'),
    constraints: readPlanListSection(state, 'constraints'),
    remarks: readRemarks(state),
    phases: buildParsedPhases(state, listedEntries, listedIds),
  };
}

export function parsePlan(markdown: string): ParsePlanResult {
  const lines = markdown.split(/\r?\n/);
  const errors: PlanParseError[] = [];
  const state = createState(errors);

  recordLengthError(state, markdown);
  scanDocument(lines, state);
  recordEmptyDocumentError(state);
  finaliseBulletsInState(state);
  validateMissingSections(state, lines.length);

  const { listedEntries, listedIds } = collectPhaseList(state);
  const plan = buildParsedPlan(state, listedEntries, listedIds);

  if (errors.length === 0) return { ok: true, plan };

  errors.sort((a, b) => (a.line === b.line ? a.code.localeCompare(b.code) : a.line - b.line));
  return { ok: false, errors };
}
