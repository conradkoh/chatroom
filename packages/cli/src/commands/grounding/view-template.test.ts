/**
 * grounding view-template — Unit Tests
 *
 * The command is static: it prints the generated grounding template and never exits.
 */

import { viewGroundingTemplate } from '@workspace/backend/prompts/cli/grounding/view-template.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { printGroundingViewTemplate } from './view-template';

let logSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('printGroundingViewTemplate', () => {
  test('prints the grounding template in one call and never exits', () => {
    printGroundingViewTemplate();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(viewGroundingTemplate());
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
