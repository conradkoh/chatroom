import { convertHtmlToDocx } from 'dom-docx/browser';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';

import { downloadBlobFile, messageExportFilename } from './downloadTextFile';
import {
  MERMAID_EXPORT_PLACEHOLDER_PREFIX,
  replaceMermaidFencesWithSvg,
} from './replaceMermaidFencesWithSvg';
import { chatroomRemarkPlugins } from '../../components/chatroomRemarkPlugins';
import { fullMarkdownComponents } from '../../components/markdown-utils';
import type { Message } from '../../types/message';

function injectMermaidDiagrams(bodyHtml: string, diagrams: Map<number, string>): string {
  let html = bodyHtml;
  for (const [index, svg] of diagrams) {
    const placeholder = `${MERMAID_EXPORT_PLACEHOLDER_PREFIX}${index}`;
    const diagramHtml = `<div class="export-diagram" style="margin:12px 0;text-align:center;">${svg}</div>`;
    html = html.replace(new RegExp(`<p>\\s*${placeholder}\\s*</p>`, 'g'), diagramHtml);
    html = html.replace(placeholder, diagramHtml);
  }
  return html;
}

export async function exportMessageAsDocx(message: Message): Promise<void> {
  const { markdown, diagrams } = await replaceMermaidFencesWithSvg(message.content);

  const bodyHtml = injectMermaidDiagrams(
    renderToStaticMarkup(
      <Markdown remarkPlugins={chatroomRemarkPlugins} components={fullMarkdownComponents}>
        {markdown}
      </Markdown>
    ),
    diagrams
  );

  const role = message.senderRole ?? 'message';
  const timestamp = new Date(message._creationTime).toLocaleString();

  const headerHtml = renderToStaticMarkup(
    <div
      style={{
        borderBottom: '2px solid #e5e5e5',
        paddingBottom: 12,
        marginBottom: 20,
        fontSize: 12,
        color: '#666',
      }}
    >
      <strong style={{ color: '#1a1a1a' }}>{role}</strong>
      {' — '}
      {timestamp}
    </div>
  );

  const htmlFragment = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; line-height: 1.6; font-size: 14px;">${headerHtml}${bodyHtml}</div>`;

  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;';
  root.innerHTML = htmlFragment;
  document.body.appendChild(root);

  try {
    const blob = await convertHtmlToDocx(htmlFragment, {
      styleSource: 'inline',
      root,
      rasterizeInPlace: { scale: 2 },
    });
    downloadBlobFile(messageExportFilename(message, 'docx'), blob);
  } finally {
    document.body.removeChild(root);
  }
}
