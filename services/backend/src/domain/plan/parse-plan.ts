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
 * - `None.` is honoured only for `Sources`, `Constraints` and per-phase
 *   `Depends on`; anywhere else it is an error.
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

const PHASE_ENTRY_PATTERN = /^P([1-9]\d*)\s+[—–-]\s+(.+)$/;

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

export function parsePlan(markdown: string): ParsePlanResult {
  const lines = markdown.split(/\r?\n/);
  const lastLineNumber = lines.length;
  const errors: PlanParseError[] = [];
  const record = (code: PlanParseErrorCode, line: number, message: string) => {
    errors.push({ code, line, message });
  };

  if (markdown.length > PLAN_MAX_CHARS) {
    record(
      'PLAN_TOO_LONG',
      1,
      `Plan must be ${PLAN_MAX_CHARS} characters or less (got ${markdown.length})`
    );
  }

  let title: string | null = null;
  let firstContentSeen = false;
  let lastSectionRank = -1;
  let currentSection: PlanSectionName | null = null;
  let currentPhase: PhaseBlock | null = null;
  let currentPhaseSection: PlanPhaseSectionName | null = null;
  let currentBullet: Bullet | null = null;
  let orphanReported = false;
  let inFence = false;
  let fenceMarker: string | null = null;

  const sectionHeadings = new Map<PlanSectionName, number>();
  const sectionBullets = new Map<PlanSectionName, Bullet[]>();
  const remarksLines: string[] = [];
  const phaseListBullets: Bullet[] = [];
  const phaseBlocks: PhaseBlock[] = [];

  const reportOrphan = (line: number) => {
    if (orphanReported) return;
    orphanReported = true;
    record('PLAN_SECTION_ORDER', line, 'Content appears outside any recognised plan section');
  };

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const raw = lines[index];
    const trimmed = raw.trim();

    // ── Fence tracking (must run before heading/bullet detection) ─────────
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
      if (currentSection === 'remarks') {
        remarksLines.push(raw);
      } else if (currentSection === 'phases') {
        // Fences are not meaningful in a single-line phase list.
        record(
          'PLAN_PHASE_ID_INVALID',
          lineNumber,
          'Phase list entries must be a single line of the form "- P1 — <title>"'
        );
      } else if (currentBullet) {
        currentBullet.text += `\n${raw}`;
      } else if (trimmed.length > 0) {
        reportOrphan(lineNumber);
      }
      continue;
    }

    // ── Blank lines are ignored (except in Remarks) ───────────────────────
    if (trimmed.length === 0) {
      if (currentSection === 'remarks') remarksLines.push(raw);
      continue;
    }

    // ── Title (first non-blank line) ──────────────────────────────────────
    if (!firstContentSeen) {
      firstContentSeen = true;
      const titleMatch = /^#\s+(.+)$/.exec(trimmed);
      if (titleMatch) {
        title = titleMatch[1].trim();
        continue;
      }
      record('PLAN_TITLE_MISSING', lineNumber, 'The plan title must be an H1 on the first line');
    }

    // ── Headings ──────────────────────────────────────────────────────────
    if (trimmed.startsWith('#### ')) {
      const name = lookupPhaseSectionName(trimmed.slice(5));
      currentBullet = null;
      if (currentSection !== 'phaseDetails' || !currentPhase) {
        record(
          'PLAN_SECTION_ORDER',
          lineNumber,
          'Phase sub-section headings are only valid inside a "### Pn" block'
        );
        orphanReported = false;
        continue;
      }
      if (!name) {
        record('PLAN_SECTION_ORDER', lineNumber, `Unrecognised phase sub-section "${trimmed}"`);
        orphanReported = false;
        continue;
      }
      const rank = PLAN_PHASE_SECTION_ORDER.indexOf(name);
      if (currentPhase.sections.has(name)) {
        record('PLAN_SECTION_ORDER', lineNumber, `Duplicate phase sub-section "${trimmed}"`);
      } else if (rank <= currentPhase.lastSectionRank) {
        record('PLAN_SECTION_ORDER', lineNumber, `Phase sub-section "${trimmed}" is out of order`);
      } else {
        currentPhase.lastSectionRank = rank;
        currentPhaseSection = name;
        currentPhase.sections.set(name, []);
        orphanReported = false;
      }
      continue;
    }

    if (trimmed.startsWith('### ')) {
      const heading = trimmed.slice(4);
      currentBullet = null;
      currentPhaseSection = null;
      if (currentSection !== 'phaseDetails') {
        record(
          'PLAN_SECTION_ORDER',
          lineNumber,
          'Phase detail headings are only valid inside "## Phase details"'
        );
        currentPhase = null;
        orphanReported = false;
        continue;
      }
      const entry = parsePhaseEntry(heading);
      const listedIds = new Set(
        phaseListBullets
          .map((bullet) => parsePhaseEntry(trimItem(bullet.text)))
          .filter((parsed): parsed is { id: string; title: string } => parsed !== null)
          .map((parsed) => parsed.id)
      );
      if (!entry) {
        record(
          'PLAN_PHASE_DETAIL_UNLISTED',
          lineNumber,
          `Phase detail heading "${heading}" must look like "P1 — <title>"`
        );
        currentPhase = null;
        orphanReported = false;
        continue;
      }
      if (phaseBlocks.some((block) => block.id === entry.id)) {
        record(
          'PLAN_PHASE_DETAIL_UNLISTED',
          lineNumber,
          `Duplicate phase detail block "${entry.id}"`
        );
        currentPhase = null;
        orphanReported = false;
        continue;
      }
      if (!listedIds.has(entry.id)) {
        record(
          'PLAN_PHASE_DETAIL_UNLISTED',
          lineNumber,
          `Phase detail "${entry.id}" is not listed in "## Phases"`
        );
        currentPhase = null;
        orphanReported = false;
        continue;
      }
      const block: PhaseBlock = {
        id: entry.id,
        title: entry.title,
        line: lineNumber,
        lastSectionRank: -1,
        sections: new Map(),
      };
      phaseBlocks.push(block);
      currentPhase = block;
      currentPhaseSection = null;
      orphanReported = false;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      const name = lookupSectionName(trimmed.slice(3));
      currentBullet = null;
      currentPhase = null;
      currentPhaseSection = null;
      orphanReported = false;
      const rank = name ? PLAN_SECTION_ORDER.indexOf(name) : -1;
      if (!name) {
        record('PLAN_SECTION_ORDER', lineNumber, `Unrecognised section heading "${trimmed}"`);
        currentSection = null;
      } else if (sectionHeadings.has(name)) {
        record('PLAN_SECTION_ORDER', lineNumber, `Duplicate section heading "${trimmed}"`);
        currentSection = null;
      } else if (rank <= lastSectionRank) {
        record('PLAN_SECTION_ORDER', lineNumber, `Section heading "${trimmed}" is out of order`);
        currentSection = null;
      } else {
        sectionHeadings.set(name, lineNumber);
        lastSectionRank = rank;
        currentSection = name;
      }
      continue;
    }

    if (trimmed.startsWith('# ')) {
      record('PLAN_SECTION_ORDER', lineNumber, 'Only one H1 (the plan title) is allowed');
      continue;
    }

    // ── Bullets (must start at column 0) ──────────────────────────────────
    if (raw.startsWith('- ')) {
      const text = raw.slice(2);
      if (currentSection === 'remarks') {
        remarksLines.push(raw);
        continue;
      }
      if (currentSection === 'phases') {
        phaseListBullets.push({ text, line: lineNumber });
        currentBullet = null;
        continue;
      }
      if (
        currentSection === 'sources' ||
        currentSection === 'requirements' ||
        currentSection === 'constraints'
      ) {
        const bullet: Bullet = { text, line: lineNumber };
        const list = sectionBullets.get(currentSection) ?? [];
        list.push(bullet);
        sectionBullets.set(currentSection, list);
        currentBullet = bullet;
        continue;
      }
      if (currentSection === 'phaseDetails' && currentPhase && currentPhaseSection) {
        const list = currentPhase.sections.get(currentPhaseSection) ?? [];
        const bullet: Bullet = { text, line: lineNumber };
        list.push(bullet);
        currentPhase.sections.set(currentPhaseSection, list);
        currentBullet = bullet;
        continue;
      }
      reportOrphan(lineNumber);
      continue;
    }

    // ── Plain content (continuation or orphan) ────────────────────────────
    if (currentSection === 'remarks') {
      remarksLines.push(raw);
      continue;
    }
    if (currentSection === 'phases') {
      record(
        'PLAN_PHASE_ID_INVALID',
        lineNumber,
        'Phase list entries must be a single line of the form "- P1 — <title>"'
      );
      continue;
    }
    if (currentBullet) {
      currentBullet.text += `\n${raw}`;
      continue;
    }
    reportOrphan(lineNumber);
  }

  if (!firstContentSeen) {
    record('PLAN_TITLE_MISSING', 1, 'The plan title must be an H1 on the first line');
  }

  // ── Finalise bullets: trim trailing whitespace and drop empty items ─────
  const finalise = (bullets: Bullet[]): Bullet[] =>
    bullets
      .map((bullet) => ({ ...bullet, text: trimItem(bullet.text) }))
      .filter((bullet) => bullet.text.trim().length > 0);

  const finalSectionBullets = new Map<PlanSectionName, Bullet[]>();
  for (const [name, bullets] of sectionBullets) {
    finalSectionBullets.set(name, finalise(bullets));
  }
  const finalPhaseListBullets = finalise(phaseListBullets);
  for (const block of phaseBlocks) {
    for (const [name, bullets] of block.sections) {
      block.sections.set(name, finalise(bullets));
    }
  }

  // ── Missing required plan sections ──────────────────────────────────────
  for (const name of PLAN_REQUIRED_SECTIONS) {
    if (sectionHeadings.has(name)) continue;
    const rank = PLAN_SECTION_ORDER.indexOf(name);
    let line = lastLineNumber;
    for (let next = rank + 1; next < PLAN_SECTION_ORDER.length; next++) {
      const nextName = PLAN_SECTION_ORDER[next];
      const nextHeading = sectionHeadings.get(nextName);
      if (nextHeading !== undefined) {
        line = nextHeading;
        break;
      }
    }
    record(
      'PLAN_SECTION_MISSING',
      line,
      `Missing required section "## ${PLAN_SECTION_NAMES[name]}"`
    );
  }

  // ── Phases list ─────────────────────────────────────────────────────────
  const phasesHeading = sectionHeadings.get('phases');
  const phaseList = finalPhaseListBullets.map((bullet) => ({
    bullet,
    entry: parsePhaseEntry(bullet.text),
  }));
  if (phasesHeading !== undefined && phaseList.length === 0) {
    record(
      'PLAN_PHASE_LIST_EMPTY',
      phasesHeading,
      'The "## Phases" section must list at least one phase'
    );
  }
  if (phaseList.length > PLAN_MAX_PHASES) {
    record(
      'PLAN_TOO_MANY_PHASES',
      phaseList[PLAN_MAX_PHASES].bullet.line,
      `A plan may declare at most ${PLAN_MAX_PHASES} phases`
    );
  }
  const listedEntries: { id: string; title: string; line: number }[] = [];
  phaseList.forEach(({ bullet, entry }, index) => {
    const expectedId = `P${index + 1}`;
    if (!entry) {
      record(
        'PLAN_PHASE_ID_INVALID',
        bullet.line,
        `Phase entry "${bullet.text.trim()}" must look like "- Pn — <title>"`
      );
      return;
    }
    if (entry.id !== expectedId) {
      record(
        'PLAN_PHASE_ID_INVALID',
        bullet.line,
        `Phase ids must be sequential: expected "${expectedId}", got "${entry.id}"`
      );
      return;
    }
    listedEntries.push({ id: entry.id, title: entry.title, line: bullet.line });
  });
  const listedIds = new Set(listedEntries.map((entry) => entry.id));

  // ── Plan-level list sections ────────────────────────────────────────────
  const readPlanListSection = (name: PlanSectionName, noneAllowed: boolean): string[] => {
    const heading = sectionHeadings.get(name);
    if (heading === undefined) return [];
    const bullets = finalSectionBullets.get(name) ?? [];
    if (bullets.length === 0) {
      record(
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
          'PLAN_SECTION_EMPTY',
          noneBullets[0].line,
          `"${PLAN_NONE_TOKEN}" is not allowed in "## ${PLAN_SECTION_NAMES[name]}"`
        );
      }
      return items.map((bullet) => bullet.text);
    }
    if (noneBullets.length > 0 && bullets.length > 1) {
      record(
        'PLAN_SECTION_ORDER',
        noneBullets[0].line,
        `"${PLAN_NONE_TOKEN}" must be the only item in "${PLAN_SECTION_NAMES[name]}"`
      );
      return items.map((bullet) => bullet.text);
    }
    if (noneBullets.length > 0) return [];
    return items.map((bullet) => bullet.text);
  };

  const sources = readPlanListSection('sources', PLAN_NONE_ALLOWED_SECTIONS.includes('sources'));
  const requirements = readPlanListSection(
    'requirements',
    PLAN_NONE_ALLOWED_SECTIONS.includes('requirements')
  );
  const constraints = readPlanListSection(
    'constraints',
    PLAN_NONE_ALLOWED_SECTIONS.includes('constraints')
  );

  // ── Remarks ─────────────────────────────────────────────────────────────
  const remarksHeading = sectionHeadings.get('remarks');
  let remarks: string | null = null;
  if (remarksHeading !== undefined) {
    const raw = remarksLines.join('\n').trim();
    if (raw.length === 0) {
      record('PLAN_SECTION_EMPTY', remarksHeading, 'The "## Remarks" section must not be empty');
    } else {
      remarks = raw;
    }
  }

  // ── Phase details cross-check ───────────────────────────────────────────
  const phaseDetailsHeading = sectionHeadings.get('phaseDetails');
  if (phaseDetailsHeading !== undefined) {
    const blocksById = new Map(phaseBlocks.map((block) => [block.id, block]));
    for (const entry of listedEntries) {
      const block = blocksById.get(entry.id);
      if (!block) {
        record(
          'PLAN_PHASE_DETAIL_MISSING',
          phaseDetailsHeading,
          `Missing "### ${entry.id} — ${entry.title}" block in "## Phase details"`
        );
        continue;
      }
      if (block.title !== entry.title) {
        record(
          'PLAN_PHASE_TITLE_MISMATCH',
          block.line,
          `Phase "${entry.id}" title must match the list: expected "${entry.title}", got "${block.title}"`
        );
      }
    }
  }

  // ── Phase sub-sections ──────────────────────────────────────────────────
  const parsedPhases: ParsedPhase[] = [];
  const blocksById = new Map(phaseBlocks.map((block) => [block.id, block]));
  for (const entry of listedEntries) {
    const block = blocksById.get(entry.id);
    if (!block) {
      parsedPhases.push({
        id: entry.id,
        title: entry.title,
        dependsOn: [],
        requirements: [],
        constraints: [],
        acceptance: [],
      });
      continue;
    }

    const readPhaseSection = (name: PlanPhaseSectionName): string[] => {
      const bullets = block.sections.get(name) ?? [];
      const noneAllowed = PLAN_NONE_ALLOWED_PHASE_SECTIONS.includes(name);
      if (bullets.length === 0) {
        record(
          'PLAN_PHASE_SECTION_MISSING',
          block.line,
          `Phase "${block.id}" is missing its "${PLAN_PHASE_SECTION_NAMES[name]}" sub-section`
        );
        return [];
      }
      const noneBullets = bullets.filter((bullet) => isNoneToken(bullet.text));
      const items = bullets.filter((bullet) => !isNoneToken(bullet.text));
      if (!noneAllowed) {
        if (noneBullets.length > 0) {
          record(
            'PLAN_PHASE_SECTION_MISSING',
            noneBullets[0].line,
            `"${PLAN_NONE_TOKEN}" is not allowed in "${block.id}" ${PLAN_PHASE_SECTION_NAMES[name]}`
          );
        }
        return items.map((bullet) => bullet.text);
      }
      if (noneBullets.length > 0 && bullets.length > 1) {
        record(
          'PLAN_SECTION_ORDER',
          noneBullets[0].line,
          `"${PLAN_NONE_TOKEN}" must be the only item in "${block.id}" ${PLAN_PHASE_SECTION_NAMES[name]}`
        );
        return items.map((bullet) => bullet.text);
      }
      if (noneBullets.length > 0) return [];
      return items.map((bullet) => bullet.text);
    };

    // `Depends on` is optional; when present, `None.` means "no dependencies".
    const dependsOnBullets = block.sections.get('dependsOn') ?? [];
    const noneDepends = dependsOnBullets.filter((bullet) => isNoneToken(bullet.text));
    let dependsOn: Bullet[] = [];
    if (noneDepends.length > 0 && dependsOnBullets.length > 1) {
      record(
        'PLAN_SECTION_ORDER',
        noneDepends[0].line,
        `"${PLAN_NONE_TOKEN}" must be the only entry in "${block.id}" Depends on`
      );
      dependsOn = dependsOnBullets.filter((bullet) => !isNoneToken(bullet.text));
    } else if (noneDepends.length === 0) {
      dependsOn = dependsOnBullets;
    }

    const currentNumber = phaseNumber(block.id);
    const validatedDependsOn: string[] = [];
    for (const bullet of dependsOn) {
      const text = bullet.text.trim();
      const match = PLAN_PHASE_ID_PATTERN.exec(text);
      const referenced = match ? `P${match[1]}` : null;
      if (!referenced || phaseNumber(referenced) >= currentNumber || !listedIds.has(referenced)) {
        record(
          'PLAN_DEPENDS_ON_INVALID',
          bullet.line,
          `"${text}" must reference an earlier phase listed in "## Phases"`
        );
        continue;
      }
      validatedDependsOn.push(referenced);
    }

    parsedPhases.push({
      id: block.id,
      title: block.title,
      dependsOn: validatedDependsOn,
      requirements: readPhaseSection('requirements'),
      constraints: readPhaseSection('constraints'),
      acceptance: readPhaseSection('acceptance'),
    });
  }

  if (errors.length > 0) {
    errors.sort((a, b) => (a.line === b.line ? a.code.localeCompare(b.code) : a.line - b.line));
    return { ok: false, errors };
  }

  return {
    ok: true,
    plan: {
      title: title ?? '',
      sources,
      requirements,
      constraints,
      phases: parsedPhases,
      remarks,
    },
  };
}
