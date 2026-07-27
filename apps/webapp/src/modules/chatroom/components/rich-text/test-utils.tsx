import { render } from '@testing-library/react';
import { useEffect, useState } from 'react';

import { RichTextEditor } from './RichTextEditor';

/**
 * Helper that renders a RichTextEditor and captures the markdown output
 * after the editor initializes and processes the initial content.
 */
export function waitForEditor(initial: string): Promise<{ render: () => void; result: string }> {
  return new Promise((resolve) => {
    let captured = '';

    function TestHarness() {
      const [value, setValue] = useState(initial);

      useEffect(() => {
        // After mount + one tick, capture the serialized markdown
        const id = setTimeout(() => {
          captured = value;
        }, 50);
        return () => clearTimeout(id);
      }, []);

      return (
        <RichTextEditor
          value={initial}
          onChange={(md) => {
            setValue(md);
            captured = md;
          }}
        />
      );
    }

    const { unmount } = render(<TestHarness />);

    // Wait for tiptap to mount and process
    setTimeout(() => {
      resolve({
        render: () => {},
        result: captured,
      });
    }, 100);
  });
}
