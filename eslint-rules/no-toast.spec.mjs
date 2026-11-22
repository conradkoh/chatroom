import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'bun:test';
import { Linter, RuleTester } from 'eslint';

import noToast from './no-toast.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const PRODUCT_FILE = 'apps/webapp/src/features/chat/view.tsx';
const UI_FILE = 'apps/webapp/src/components/ui/feature.tsx';
const err = { messageId: 'noToast' };

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' },
});

ruleTester.run('no-toast', noToast, {
  valid: [
    { code: "import { Alert } from '@/components/ui/alert';", filename: PRODUCT_FILE },
    { code: "import { Button } from '@/components/ui/button';", filename: PRODUCT_FILE },
    { code: "import { useState } from 'react';", filename: PRODUCT_FILE },
    { code: "import { x } from '@/components/ui/toaster-config';", filename: PRODUCT_FILE },
    { code: "import { Alert } from '../../components/ui/alert';", filename: PRODUCT_FILE },
    { code: "import { local } from './toast-free';", filename: UI_FILE },
    { code: 'const mod = await import(moduleName);', filename: PRODUCT_FILE },
  ],
  invalid: [
    // Toast libraries (static import, subpath, re-export, dynamic, require)
    { code: "import { toast } from 'sonner';", filename: PRODUCT_FILE, errors: [err] },
    { code: "import { toast } from 'react-hot-toast';", filename: PRODUCT_FILE, errors: [err] },
    {
      code: "import { ToastContainer } from 'react-toastify';",
      filename: PRODUCT_FILE,
      errors: [err],
    },
    {
      code: "import * as Toast from '@radix-ui/react-toast';",
      filename: PRODUCT_FILE,
      errors: [err],
    },
    {
      code: "import { Toast } from '@base-ui/react/toast';",
      filename: PRODUCT_FILE,
      errors: [err],
    },
    { code: "import 'react-hot-toast/dist/index.css';", filename: PRODUCT_FILE, errors: [err] },
    { code: "export { toast } from 'sonner';", filename: PRODUCT_FILE, errors: [err] },
    { code: "const m = await import('sonner');", filename: PRODUCT_FILE, errors: [err] },
    { code: "const { toast } = require('sonner');", filename: PRODUCT_FILE, errors: [err] },
    // shadcn toast modules: alias, bare, re-export, dynamic
    {
      code: "import { Toast } from '@/components/ui/toast';",
      filename: PRODUCT_FILE,
      errors: [err],
    },
    {
      code: "import { Toaster } from '@/components/ui/toaster';",
      filename: PRODUCT_FILE,
      errors: [err],
    },
    {
      code: "import { Toaster } from '@/components/ui/sonner';",
      filename: PRODUCT_FILE,
      errors: [err],
    },
    {
      code: "import { useToast } from '@/hooks/use-toast';",
      filename: PRODUCT_FILE,
      errors: [err],
    },
    {
      code: "import { Toaster } from 'components/ui/toaster';",
      filename: PRODUCT_FILE,
      errors: [err],
    },
    { code: "export * from '@/components/ui/toaster';", filename: PRODUCT_FILE, errors: [err] },
    // relative forms, resolved from the file's directory
    { code: "import { Toaster } from './toaster';", filename: UI_FILE, errors: [err] },
    { code: "import { Toast } from './toast';", filename: UI_FILE, errors: [err] },
    { code: "import { Toaster } from './sonner';", filename: UI_FILE, errors: [err] },
    {
      code: "import { useToast } from '../../hooks/use-toast';",
      filename: PRODUCT_FILE,
      errors: [err],
    },
  ],
});

describe('no-toast end-to-end through flat config', () => {
  it('reports a toast import under the local/no-toast rule id with the doc path in the message', () => {
    const linter = new Linter({ configType: 'flat' });
    const messages = linter.verify(
      "import { toast } from 'sonner';",
      [
        {
          files: ['**/*.{ts,tsx,js,jsx}'],
          languageOptions: { parser: tsParser, sourceType: 'module' },
          plugins: { local: { rules: { 'no-toast': noToast } } },
          rules: { 'local/no-toast': 'error' },
        },
      ],
      PRODUCT_FILE
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe('local/no-toast');
    expect(messages[0].message).toContain('docs/application/design/theme.md');
    expect(messages[0].message).toContain('Feedback & Notifications');
  });
});
