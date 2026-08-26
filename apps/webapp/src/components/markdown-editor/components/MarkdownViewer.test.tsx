import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownViewer } from './MarkdownViewer';

const sampleMarkdown = `# Heading One

## Heading Two

- List item one
- List item two

Visit [example link](https://example.com) for more.

Inline \`code\` and fenced block:

\`\`\`js
const greeting = 'hello';
\`\`\`

| Col A | Col B |
| ----- | ----- |
| A1    | B1    |
`;

describe('MarkdownViewer', () => {
  it('renders headings from markdown', () => {
    render(<MarkdownViewer markdown={sampleMarkdown} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Heading One' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Heading Two' })).toBeInTheDocument();
  });

  it('renders lists and links', () => {
    render(<MarkdownViewer markdown={sampleMarkdown} />);
    expect(screen.getByText('List item one')).toBeInTheDocument();
    expect(screen.getByText('List item two')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'example link' })).toHaveAttribute(
      'href',
      'https://example.com'
    );
  });

  it('renders inline and fenced code', () => {
    render(<MarkdownViewer markdown={sampleMarkdown} />);
    expect(screen.getByText('code')).toBeInTheDocument();
    expect(screen.getByText("const greeting = 'hello';")).toBeInTheDocument();
  });

  it('renders table cells', () => {
    render(<MarkdownViewer markdown={sampleMarkdown} />);
    expect(screen.getByText('Col A')).toBeInTheDocument();
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('B1')).toBeInTheDocument();
  });

  it('renders blank lines from nbsp empty paragraphs', () => {
    const { container } = render(
      <MarkdownViewer markdown={'This is some content\n\n&nbsp;\n\nabc'} />
    );
    expect(container.querySelectorAll('p.min-h-\\[1\\.5em\\][aria-hidden="true"]')).toHaveLength(1);
    expect(screen.getByText('This is some content')).toBeInTheDocument();
    expect(screen.getByText('abc')).toBeInTheDocument();
  });

  it('renders blank lines around fenced code blocks from nbsp paragraphs', () => {
    const markdown = 'This is some content!\n\n&nbsp;\n\n```txt\nasdasd\nasdsad\n```\n\n&nbsp;\n';
    const { container } = render(<MarkdownViewer markdown={markdown} />);

    expect(container.querySelectorAll('p.min-h-\\[1\\.5em\\][aria-hidden="true"]')).toHaveLength(2);
    expect(screen.getByText('This is some content!')).toBeInTheDocument();
    expect(container.querySelector('code')).toHaveTextContent('asdasd');
  });
});
