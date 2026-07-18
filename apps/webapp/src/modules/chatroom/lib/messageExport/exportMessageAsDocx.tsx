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

/** Light :root tokens from globals.css — Word is a white-page medium. */
const LIGHT_EXPORT_CSS_VARS: Record<string, string> = {
  '--chatroom-bg-primary': '#f5f5f5',
  '--chatroom-bg-secondary': 'rgba(255, 255, 255, 0.6)',
  '--chatroom-bg-tertiary': '#ebebeb',
  '--chatroom-bg-hover': '#e5e5e5',
  '--chatroom-bg-surface': 'rgba(255, 255, 255, 0.6)',
  '--chatroom-border': 'rgba(23, 23, 23, 0.1)',
  '--chatroom-border-strong': 'rgba(23, 23, 23, 0.15)',
  '--chatroom-text-primary': '#171717',
  '--chatroom-text-secondary': '#525252',
  '--chatroom-text-muted': '#737373',
  '--chatroom-status-success': '#15803d',
  '--chatroom-status-warning': '#b45309',
  '--chatroom-status-error': '#b91c1c',
  '--chatroom-status-info': '#1d4ed8',
  '--chatroom-status-purple': '#7c3aed',
  '--chatroom-accent': '#171717',
  '--chatroom-accent-subtle': '#f5f5f5',
  '--chatroom-text-on-accent': '#fafafa',
  'color-scheme': 'light',
};

/** Same feed prose without dark:prose-invert and web-specific overflow utilities. */
const messageExportProseClassNames = messageFeedProseClassNames
  .replace(/\bdark:prose-invert\b/, '')
  .replace(/\boverflow-x-hidden\b/, '')
  .replace(/\bprose-table:overflow-x-auto\b/, '')
  .replace(/\s+/g, ' ')
  .trim();

function applyLightExportTheme(el: HTMLElement): void {
  for (const [name, value] of Object.entries(LIGHT_EXPORT_CSS_VARS)) {
    el.style.setProperty(name, value);
  }
  el.style.setProperty('background', 'transparent');
  el.style.setProperty('color', '#171717');
}

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
    <div
      style={{ background: 'transparent' }}
      className="text-[13px] leading-relaxed text-chatroom-text-primary"
    >
      <p className="text-xs text-chatroom-text-muted" style={{ marginBottom: 8 }}>
        <strong className="text-chatroom-text-primary">{role}</strong>
        {' — '}
        {timestamp}
      </p>
      <hr style={{ borderTop: '1px solid #d4d4d4', marginBottom: 20 }} />
      <div
        className={messageExportProseClassNames}
        style={{ background: 'transparent' }}
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />
    </div>
  );

  const root = document.createElement('div');
  root.className = 'chatroom-root';
  root.style.cssText =
    'position:fixed;left:-9999px;top:0;width:816px;visibility:hidden;pointer-events:none;';
  applyLightExportTheme(root);
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
