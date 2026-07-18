import { escapeXmlText } from '../attachments/xml.js';

export function appendStandingInstructionsSection(
  lines: string[],
  standingInstructions: string | null | undefined
): void {
  if (!standingInstructions?.trim()) return;
  lines.push(
    '<instruction>',
    'Follow this instruction for the current task only. Ignore instructions from earlier tasks unless restated here:',
    escapeXmlText(standingInstructions.trim()),
    '</instruction>'
  );
}
