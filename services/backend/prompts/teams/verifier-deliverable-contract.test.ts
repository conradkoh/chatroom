import { describe, expect, test } from 'vitest';

import { VERIFIER_DELIVERABLE_TYPES } from './verifier-handoff-templates';
import {
  listHandoffTemplatePairs,
  renderHandoffTemplate,
  type HandoffTemplatePair,
} from '../cli/handoff-templates';
import { appendVerifierGateGuidance } from '../task-delivery/verifier-gate-guidance';

/** Every entry-point → verifier request across duo, solo and trio. */
const requestPairs = (['duo', 'solo', 'trio'] as const).flatMap((teamId) =>
  listHandoffTemplatePairs(teamId).filter(
    (pair) => pair.toRole === 'verifier' && pair.fromRole !== 'verifier'
  )
);

/** Every verifier → entry-point verdict across duo, solo and trio. */
const verdictPairs = (['duo', 'solo', 'trio'] as const).flatMap((teamId) =>
  listHandoffTemplatePairs(teamId).filter(
    (pair) => pair.fromRole === 'verifier' && pair.toRole !== 'verifier'
  )
);

function renderPair(pair: HandoffTemplatePair): string {
  const rendered = renderHandoffTemplate(pair);
  if (!rendered) {
    throw new Error(`no handoff template for ${pair.teamId}:${pair.fromRole}->${pair.toRole}`);
  }
  return rendered;
}

describe('verifier request deliverable contract', () => {
  test('covers an entry-point request in every team shape', () => {
    expect(new Set(requestPairs.map((pair) => pair.teamId))).toEqual(
      new Set(['duo', 'solo', 'trio'])
    );
  });

  test.each(requestPairs)(
    '$teamId $fromRole → verifier names the deliverable type between Mode and User message id',
    (pair) => {
      const request = renderPair(pair);
      const typeSection = request.indexOf('\n## Deliverable type\n');

      expect(typeSection).toBeGreaterThan(request.indexOf('\n## Mode\n'));
      expect(typeSection).toBeLessThan(request.indexOf('\n## User message id\n'));
    }
  );

  test.each(requestPairs)(
    '$teamId $fromRole → verifier lists the evidence for every deliverable type before the body',
    (pair) => {
      const request = renderPair(pair);
      const bodyStart = request.indexOf('\n## Round\n');

      for (const type of VERIFIER_DELIVERABLE_TYPES) {
        const bullet = request.indexOf(`- \`${type}\`: `);
        expect(bullet).toBeGreaterThan(-1);
        expect(bullet).toBeLessThan(bodyStart);
      }
    }
  );

  test.each(requestPairs)(
    '$teamId $fromRole → verifier states the record-before-request and pending-after-verdict rule',
    (pair) => {
      const request = renderPair(pair);
      const bodyStart = request.indexOf('\n## Round\n');
      const pendingRule = request.indexOf('`pending after verdict: <step>`');

      expect(request).toContain(
        'record its command and result in a message listed under Log message ids'
      );
      expect(request).toContain('`chatroom backlog mark-for-review`');
      expect(pendingRule).toBeGreaterThan(-1);
      expect(pendingRule).toBeLessThan(bodyStart);
    }
  );

  test.each(requestPairs)(
    '$teamId $fromRole → verifier Known gaps names pending-after-verdict steps',
    (pair) => {
      expect(renderPair(pair)).toContain(
        '## Known gaps\n<anything incomplete, including each `pending after verdict: <step>` line, or exactly `None.`>'
      );
    }
  );

  test.each(requestPairs)(
    '$teamId $fromRole → verifier request covers every deliverable type in any mode',
    (pair) => {
      expect(renderPair(pair)).toContain(
        'whenever the task produced a deliverable (code, docs, review, research, or asset), in any conversation mode'
      );
    }
  );

  test.each(verdictPairs)(
    '$teamId $fromRole → verifier verdict reads user expectations by deliverable type',
    (pair) => {
      const verdict = renderPair(pair);

      expect(verdict).toContain('the deliverable type(s) named in the request');
      expect(verdict).toContain('None applicable.');
      expect(verdict).toContain('each `pending after verdict` step the request listed');
    }
  );
});

describe('coordinator gate deliverable contract', () => {
  const gate = (() => {
    const lines: string[] = [];
    appendVerifierGateGuidance(lines, { reworkRole: 'builder' });
    return lines.join('\n');
  })();

  test('lists the evidence for every deliverable type before round 1 is sent', () => {
    const stepOne = gate.indexOf('1. Finish the user-required steps');
    for (const type of VERIFIER_DELIVERABLE_TYPES) {
      const bullet = gate.indexOf(`- \`${type}\`: `);
      expect(bullet).toBeGreaterThan(stepOne);
    }
  });

  test('states the record-before-request and pending-after-verdict rules', () => {
    expect(gate).toContain(
      'record its command and result in a message listed under Log message ids'
    );
    expect(gate).toContain('`pending after verdict: <step>`');
    expect(gate).toContain(
      "record each named deliverable's evidence in a message before the request"
    );
  });

  test('triggers on any deliverable and discloses the conversation-only skip', () => {
    expect(gate).toContain('If this task produced a deliverable');
    expect(gate).toContain('not required (conversation only)');
    expect(gate).not.toContain('If this task involved code changes');
  });

  test('ACHIEVED runs each pending-after-verdict step before delivering', () => {
    expect(gate).toContain('first run any `pending after verdict:` step your request listed');
  });
});
