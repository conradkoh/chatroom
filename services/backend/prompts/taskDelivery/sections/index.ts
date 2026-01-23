/**
 * Section registry - exports all prompt sections and their composition order.
 */

import type { PromptSection } from '../types';
import { backlogCommandsSection } from './backlogCommands';
import { chatroomStateSection } from './chatroomState';
import { messageReceivedSection } from './messageReceived';
import { nextStepsSection } from './nextSteps';
import { roleGuidanceSection } from './roleGuidance';

export { messageReceivedSection } from './messageReceived';
export { chatroomStateSection } from './chatroomState';
export { nextStepsSection } from './nextSteps';
export { roleGuidanceSection } from './roleGuidance';
export { backlogCommandsSection } from './backlogCommands';
export { buildJsonOutput } from './jsonOutput';

/**
 * All sections in display order.
 * Sections will be filtered by shouldRender() at runtime.
 */
export const ALL_SECTIONS: PromptSection[] = [
  messageReceivedSection,
  chatroomStateSection,
  nextStepsSection,
  roleGuidanceSection,
  backlogCommandsSection,
];
