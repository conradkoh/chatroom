import { escapeXmlText } from '../attachments/xml.js';

export function appendStandingInstructionsSection(
  lines: string[],
  standingInstructions: string | null | undefined
): void {
  if (!standingInstructions?.trim()) return;
  lines.push(
    '<standing-instructions>',
    'The user has set standing instructions for this chatroom. Apply to every task:',
    escapeXmlText(standingInstructions.trim()),
    '</standing-instructions>'
  );
}
