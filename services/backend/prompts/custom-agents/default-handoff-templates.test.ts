import {
  RESERVED_DELIMITER_LINES,
  neutralizeChatroomBlockTags,
} from '@workspace/shared/domain/custom-agent';
import { describe, expect, it } from 'vitest';

import {
  defaultInboundHandoffTemplate,
  defaultReturnHandoffTemplate,
} from './default-handoff-templates';

const AGENT = 'alpha';
const ENTRY_POINT = 'planner';

/** Neutralisation is the identity only when the text contains no reserved block tag. */
function hasReservedBlockTag(text: string): boolean {
  return neutralizeChatroomBlockTags(text) !== text;
}

function hasReservedDelimiterLine(text: string): boolean {
  return text
    .split('\n')
    .some((line) => RESERVED_DELIMITER_LINES.some((delimiter) => line === delimiter));
}

describe('defaultInboundHandoffTemplate', () => {
  it('renders the task, context, and expected result sections', () => {
    expect(defaultInboundHandoffTemplate(AGENT)).toMatchInlineSnapshot(`
      "## Task

      State the task alpha is being asked to take on, in one or two sentences.

      ## Context

      Give the background the task depends on: relevant files, links, decisions already made, and anything explicitly out of scope.

      ## Expected result

      Describe the concrete outcome alpha should return, and what must not change while producing it."
    `);
  });

  it('names the delegate', () => {
    expect(defaultInboundHandoffTemplate(AGENT)).toContain(AGENT);
  });

  it('contains no reserved block tag or delimiter line', () => {
    const template = defaultInboundHandoffTemplate(AGENT);

    expect(hasReservedBlockTag(template)).toBe(false);
    expect(hasReservedDelimiterLine(template)).toBe(false);
  });
});

describe('defaultReturnHandoffTemplate', () => {
  it('renders the summary, result, and open issues sections', () => {
    expect(defaultReturnHandoffTemplate(AGENT, ENTRY_POINT)).toMatchInlineSnapshot(`
      "## Summary

      alpha reports back to planner on the work just completed.

      ## Findings or result

      State the outcome plainly: what changed, what was verified, and any decision the rest of the team must know about.

      ## Open issues

      List anything unresolved, blocked, or needing a decision. Write "None." when nothing is outstanding."
    `);
  });

  it('names the agent and its entry point', () => {
    const template = defaultReturnHandoffTemplate(AGENT, ENTRY_POINT);

    expect(template).toContain(AGENT);
    expect(template).toContain(ENTRY_POINT);
  });

  it('contains no reserved block tag or delimiter line', () => {
    const template = defaultReturnHandoffTemplate(AGENT, ENTRY_POINT);

    expect(hasReservedBlockTag(template)).toBe(false);
    expect(hasReservedDelimiterLine(template)).toBe(false);
  });
});
