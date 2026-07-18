import { convertHtmlToDocx } from 'dom-docx/browser';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';

import { downloadBlobFile, messageExportFilename } from './downloadTextFile';
import {
  MERMAID_EXPORT_PLACEHOLDER_PREFIX,
  replaceMermaidFencesWithSvg,
} from './replaceMermaidFencesWithSvg';
import { exportMarkdownComponents } from './exportMarkdownComponents';
import { messageFeedProseClassNames } from '../../components/markdown-utils';
import { chatroomRemarkPlugins } from '../../components/chatroomRemarkPlugins';
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
      <Markdown remarkPlugins={chatroomRemarkPlugins} components={exportMarkdownComponents}>
        {markdown}
      </Markdown>
    ),
    diagrams
  );

  const role = message.senderRole ?? 'message';
  const timestamp = new Date(message._creationTime).toLocaleString();

  const htmlFragment = renderToStaticMarkup(
    <div className="chatroom-root bg-chatroom-bg-primary text-chatroom-text-primary p-4 text-[13px] leading-relaxed">
      <div className="border-b-2 border-chatroom-border-strong pb-3 mb-5 text-xs text-chatroom-text-muted">
        <strong className="text-chatroom-text-primary">{role}</strong>
        {' — '}
        {timestamp}
      </div>
      <div className={messageFeedProseClassNames} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    </div>
  );

  const root = document.createElement('div');
  root.className = 'chatroom-root';
  root.style.cssText =
    'position:fixed;left:-9999px;top:0;width:816px;visibility:hidden;pointer-events:none;';
  root.innerHTML = htmlFragment;
  document.body.appendChild(root);

  try {
    const blob = await convertHtmlToDocx(htmlFragment, {
      styleSource: 'computed',
      root,
      rasterizeInPlace: { scale: 2 },
    });
    downloadBlobFile(messageExportFilename(message, 'docx'), blob);
  } finally {
    document.body.removeChild(root);
  }
}
