import { describe, expect, it } from 'vitest';

import { getDataQueryDesignTemplateBlock } from './data-query-design';

describe('getDataQueryDesignTemplateBlock', () => {
  it('includes the persistence design goal and required sections', () => {
    const block = getDataQueryDesignTemplateBlock();

    expect(block).toContain('## Persistent state and query pattern design');
    expect(block).toContain('Small updates must not cause large cache invalidations');
    expect(block).toContain('### 1. Sources of concern');
    expect(block).toContain('### 2. Schema design');
    expect(block).toContain('Hot path:');
    expect(block).toContain('Cold path:');
    expect(block).toContain('### 3. Index design (within limits)');
    expect(block).toContain('### 4. Query design (within limits)');
    expect(block).toContain(
      '<!-- Write exactly "Not Applicable." for the entire section if no persistence changes -->'
    );
  });
});
