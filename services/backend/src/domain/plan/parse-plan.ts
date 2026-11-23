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
 * - `None.` is honoured only for `Sources`, `Constraints`, per-phase
 *   `Constraints`, and per-phase `Depends on`; anywhere else it is an error.
 */

import {
  PLAN_MAX_CHARS,
  PLAN_MAX_PHASES,
  PLAN_NONE_TOKEN,
  PLAN_NONE_ALLOWED_PHASE_SECTIONS,
  PLAN_NONE_ALLOWED_SECTIONS,
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
}

interface ListedPhase {
  id: string;
  title: string;
  line: number;
}

const PHASE_ENTRY_PATTERN = /^P([1-9]\d*)\s+[—–-]\s+(.+)$/;
const TITLE_PATTERN = /^#\s+(.+)$/;

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
  };
}

function record(state: ParseState, code: PlanParseErrorCode, line: number, message: string): void {
  state.errors.push({ code, line, message });
}

function reportOrphan(state: ParseState, line: number): void {
  if (state.orphanReported) return;
  state.orphanReported = true;
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

function handlePlanSectionHeading(state: ParseState, trimmed: string, line: number): void {
  state.currentBullet = null;
  state.currentPhase = null;
  state.currentPhaseSection = null;
  state.orphanReported = false;

  const name = lookupSectionName(trimmed.slice(3));
  if (!name) {
    record(state, 'PLAN_SECTION_ORDER', line, `Unrecognised section heading "${trimmed}"`);
    state.currentSection = null;
    return;
  }
  if (state.sectionHeadings.has(name)) {
    record(state, 'PLAN_SECTION_ORDER', line, `Duplicate section heading "${trimmed}"`);
    state.currentSection = null;
    return;
  }
  const rank = PLAN_SECTION_ORDER.indexOf(name);
  if (rank <= state.lastSectionRank) {
    record(state, 'PLAN_SECTION_ORDER', line, `Section heading "${trimmed}" is out of order`);
    state.currentSection = null;
    return;
  }
  state.sectionHeadings.set(name, line);
  state.lastSectionRank = rank;
  state.currentSection = name;
}

function handlePhaseHeading(state: ParseState, heading: string, line: number): void {
  state.currentBullet = null;
  state.currentPhaseSection = null;

  if (state.currentSection !== 'phaseDetails') {
    record(
      state,
      'PLAN_SECTION_ORDER',
      line,
      'Phase detail headings are only valid inside "## Phase details"'
    );
    state.currentPhase = null;
    state.orphanReported = false;
    return;
  }

  const entry = parsePhaseEntry(heading);
  if (!entry) {
    record(
      state,
      'PLAN_PHASE_DETAIL_UNLISTED',
      line,
      `Phase detail heading "${heading}" must look like "P1 — <title>"`
    );
    state.currentPhase = null;
    state.orphanReported = false;
    return;
  }
  if (state.phaseBlocks.some((block) => block.id === entry.id)) {
    record(state, 'PLAN_PHASE_DETAIL_UNLISTED', line, `Duplicate phase detail block "${entry.id}"`);
    state.currentPhase = null;
    state.orphanReported = false;
    return;
  }
  if (!listedPhaseIds(state).has(entry.id)) {
    record(
      state,
      'PLAN_PHASE_DETAIL_UNLISTED',
      line,
      `Phase detail "${entry.id}" is not listed in "## Phases"`
    );
    state.currentPhase = null;
    state.orphanReported = false;
    return;
  }

  const block: PhaseBlock = {
    id: entry.id,
    title: entry.title,
    line,
    lastSectionRank: -1,
    sections: new Map(),
  };
  state.phaseBlocks.push(block);
  state.currentPhase = block;
  state.currentPhaseSection = null;
  state.orphanReported = false;
}

function handlePhaseSectionHeading(state: ParseState, trimmed: string, line: number): void {
  state.currentBullet = null;
  const phase = state.currentPhase;
  if (state.currentSection !== 'phaseDetails' || !phase) {
    record(
      state,
      'PLAN_SECTION_ORDER',
      line,
      'Phase sub-section headings are only valid inside a "### Pn" block'
    );
    state.orphanReported = false;
    return;
  }

  const name = lookupPhaseSectionName(trimmed.slice(5));
  if (!name) {
    record(state, 'PLAN_SECTION_ORDER', line, `Unrecognised phase sub-section "${trimmed}"`);
    state.orphanReported = false;
    return;
  }
  const rank = PLAN_PHASE_SECTION_ORDER.indexOf(name);
  if (phase.sections.has(name)) {
    record(state, 'PLAN_SECTION_ORDER', line, `Duplicate phase sub-section "${trimmed}"`);
    return;
  }
  if (rank <= phase.lastSectionRank) {
    record(state, 'PLAN_SECTION_ORDER', line, `Phase sub-section "${trimmed}" is out of order`);
    return;
  }
  phase.lastSectionRank = rank;
  state.currentPhaseSection = name;
  phase.sections.set(name, []);
  state.orphanReported = false;
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
  if (
    state.currentSection === 'sources' ||
    state.currentSection === 'requirements' ||
    state.currentSection === 'constraints'
  ) {
    const list = state.sectionBullets.get(state.currentSection) ?? [];
    appendBullet(state, list, raw, line);
    state.sectionBullets.set(state.currentSection, list);
    return;
  }
  if (state.currentSection === 'phaseDetails' && state.currentPhase && state.currentPhaseSection) {
    const list = state.currentPhase.sections.get(state.currentPhaseSection) ?? [];
    appendBullet(state, list, raw, line);
    state.currentPhase.sections.set(state.currentPhaseSection, list);
    return;
  }
  reportOrphan(state, line);
}

/** Handle a plain content line, including fence content. */
function handleContentLine(state: ParseState, raw: string, trimmed: string, line: number): void {
  if (state.currentSection === 'remarks') {
    state.remarksLines.push(raw);
    return;
  }
  if (state.currentSection === 'phases') {
    record(
      state,
      'PLAN_PHASE_ID_INVALID',
      line,
      'Phase list entries must be a single line of the form "- P1 — <title>"'
    );
    return;
  }
  if (state.currentBullet) {
    state.currentBullet.text += `\n${raw}`;
    return;
  }
  if (trimmed.length > 0) reportOrphan(state, line);
}

/** Single fence-aware pass over the document, populating `state`. */
function scanDocument(lines: string[], state: ParseState): void {
  let inFence = false;
  let fenceMarker: string | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    const raw = lines[index];
    const trimmed = raw.trim();

    const isFenceLine = trimmed.startsWith('```') || trimmed.startsWith('~~~');
    if (isFenceLine) {
      if (!inFence) {
        inFence = true;
        fenceMarker = trimmed.slice(0, 3);
      } else if (fenceMarker && trimmed.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = null;
      }
    }

    if (inFence || isFenceLine) {
      handleContentLine(state, raw, trimmed, line);
      continue;
    }

    if (trimmed.length === 0) {
      if (state.currentSection === 'remarks') state.remarksLines.push(raw);
      continue;
    }

    if (!state.firstContentSeen) {
      state.firstContentSeen = true;
      const titleMatch = TITLE_PATTERN.exec(trimmed);
      if (titleMatch) {
        state.title = titleMatch[1].trim();
        continue;
      }
      record(state, 'PLAN_TITLE_MISSING', line, 'The plan title must be an H1 on the first line');
    }

    if (trimmed.startsWith('#### ')) {
      handlePhaseSectionHeading(state, trimmed, line);
    } else if (trimmed.startsWith('### ')) {
      handlePhaseHeading(state, trimmed.slice(4), line);
    } else if (trimmed.startsWith('## ')) {
      handlePlanSectionHeading(state, trimmed, line);
    } else if (trimmed.startsWith('# ')) {
      record(state, 'PLAN_SECTION_ORDER', line, 'Only one H1 (the plan title) is allowed');
    } else if (raw.startsWith('- ')) {
      handleBulletLine(state, raw, line);
    } else {
      handleContentLine(state, raw, trimmed, line);
    }
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

function validateMissingSections(state: ParseState, lastLineNumber: number): void {
  for (const name of PLAN_REQUIRED_SECTIONS) {
    if (state.sectionHeadings.has(name)) continue;
    const rank = PLAN_SECTION_ORDER.indexOf(name);
    let line = lastLineNumber;
    for (let next = rank + 1; next < PLAN_SECTION_ORDER.length; next++) {
      const nextHeading = state.sectionHeadings.get(PLAN_SECTION_ORDER[next]);
      if (nextHeading !== undefined) {
        line = nextHeading;
        break;
      }
    }
    record(
      state,
      'PLAN_SECTION_MISSING',
      line,
      `Missing required section "## ${PLAN_SECTION_NAMES[name]}"`
    );
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

function readPlanListSection(
  state: ParseState,
  name: PlanSectionName,
  noneAllowed: boolean
): string[] {
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

  const noneBullets = bullets.filter((bullet) => isNoneToken(bullet.text));
  const items = bullets.filter((bullet) => !isNoneToken(bullet.text));
  if (!noneAllowed) {
    if (noneBullets.length > 0) {
      record(
        state,
        'PLAN_SECTION_EMPTY',
        noneBullets[0].line,
        `"${PLAN_NONE_TOKEN}" is not allowed in "## ${PLAN_SECTION_NAMES[name]}"`
      );
    }
    return items.map((bullet) => bullet.text);
  }
  if (noneBullets.length > 0 && bullets.length > 1) {
    record(
      state,
      'PLAN_SECTION_ORDER',
      noneBullets[0].line,
      `"${PLAN_NONE_TOKEN}" must be the only item in "${PLAN_SECTION_NAMES[name]}"`
    );
    return items.map((bullet) => bullet.text);
  }
  if (noneBullets.length > 0) return [];
  return items.map((bullet) => bullet.text);
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

function validatePhaseDetails(state: ParseState, listedEntries: ListedPhase[]): void {
  const phaseDetailsHeading = state.sectionHeadings.get('phaseDetails');
  if (phaseDetailsHeading === undefined) return;

  const blocksById = new Map(state.phaseBlocks.map((block) => [block.id, block]));
  for (const entry of listedEntries) {
    const block = blocksById.get(entry.id);
    if (!block) {
      record(
        state,
        'PLAN_PHASE_DETAIL_MISSING',
        phaseDetailsHeading,
        `Missing "### ${entry.id} — ${entry.title}" block in "## Phase details"`
      );
      continue;
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

  const noneBullets = bullets.filter((bullet) => isNoneToken(bullet.text));
  const items = bullets.filter((bullet) => !isNoneToken(bullet.text));
  if (!PLAN_NONE_ALLOWED_PHASE_SECTIONS.includes(name)) {
    if (noneBullets.length > 0) {
      record(
        state,
        'PLAN_PHASE_SECTION_MISSING',
        noneBullets[0].line,
        `"${PLAN_NONE_TOKEN}" is not allowed in "${block.id}" ${PLAN_PHASE_SECTION_NAMES[name]}`
      );
    }
    return items.map((bullet) => bullet.text);
  }
  if (noneBullets.length > 0 && bullets.length > 1) {
    record(
      state,
      'PLAN_SECTION_ORDER',
      noneBullets[0].line,
      `"${PLAN_NONE_TOKEN}" must be the only item in "${block.id}" ${PLAN_PHASE_SECTION_NAMES[name]}`
    );
    return items.map((bullet) => bullet.text);
  }
  if (noneBullets.length > 0) return [];
  return items.map((bullet) => bullet.text);
}

function validateDependsOn(state: ParseState, block: PhaseBlock, listedIds: Set<string>): string[] {
  const bullets = block.sections.get('dependsOn') ?? [];
  const noneBullets = bullets.filter((bullet) => isNoneToken(bullet.text));
  let candidates = bullets;
  if (noneBullets.length > 0 && bullets.length > 1) {
    record(
      state,
      'PLAN_SECTION_ORDER',
      noneBullets[0].line,
      `"${PLAN_NONE_TOKEN}" must be the only entry in "${block.id}" Depends on`
    );
    candidates = bullets.filter((bullet) => !isNoneToken(bullet.text));
  } else if (noneBullets.length > 0) {
    return [];
  }

  const currentNumber = phaseNumber(block.id);
  const validated: string[] = [];
  for (const bullet of candidates) {
    const text = bullet.text.trim();
    const match = PLAN_PHASE_ID_PATTERN.exec(text);
    const referenced = match ? `P${match[1]}` : null;
    if (!referenced || phaseNumber(referenced) >= currentNumber || !listedIds.has(referenced)) {
      record(
        state,
        'PLAN_DEPENDS_ON_INVALID',
        bullet.line,
        `"${text}" must reference an earlier phase listed in "## Phases"`
      );
      continue;
    }
    validated.push(referenced);
  }
  return validated;
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

export function parsePlan(markdown: string): ParsePlanResult {
  const lines = markdown.split(/\r?\n/);
  const errors: PlanParseError[] = [];
  const state = createState(errors);

  if (markdown.length > PLAN_MAX_CHARS) {
    record(
      state,
      'PLAN_TOO_LONG',
      1,
      `Plan must be ${PLAN_MAX_CHARS} characters or less (got ${markdown.length})`
    );
  }

  scanDocument(lines, state);

  if (!state.firstContentSeen) {
    record(state, 'PLAN_TITLE_MISSING', 1, 'The plan title must be an H1 on the first line');
  }

  finaliseBulletsInState(state);
  validateMissingSections(state, lines.length);

  const { listedEntries, listedIds } = collectPhaseList(state);
  const sources = readPlanListSection(
    state,
    'sources',
    PLAN_NONE_ALLOWED_SECTIONS.includes('sources')
  );
  const requirements = readPlanListSection(
    state,
    'requirements',
    PLAN_NONE_ALLOWED_SECTIONS.includes('requirements')
  );
  const constraints = readPlanListSection(
    state,
    'constraints',
    PLAN_NONE_ALLOWED_SECTIONS.includes('constraints')
  );
  const remarks = readRemarks(state);
  validatePhaseDetails(state, listedEntries);
  const phases = buildParsedPhases(state, listedEntries, listedIds);

  if (errors.length > 0) {
    errors.sort((a, b) => (a.line === b.line ? a.code.localeCompare(b.code) : a.line - b.line));
    return { ok: false, errors };
  }

  return {
    ok: true,
    plan: {
      title: state.title ?? '',
      sources,
      requirements,
      constraints,
      phases,
      remarks,
    },
  };
}
