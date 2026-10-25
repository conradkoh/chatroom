import { escapeXmlText } from '../attachments/xml.js';

export function appendStandingInstructionsSection(
  lines: string[],
  standingInstructions: string | null | undefined
): void {
  if (!standingInstructions?.trim()) return;
  lines.push(
    '<instruction>',
    "Follow this instruction for the current task only, as far as your role allows; your role's advisory or read-only limits take precedence. Ignore instructions from earlier tasks unless restated here:",
    escapeXmlText(standingInstructions.trim()),
    '</instruction>'
  );
}
