import convexPlugin from '@convex-dev/eslint-plugin';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactYouMightNotNeedAnEffect from 'eslint-plugin-react-you-might-not-need-an-effect';
import globals from 'globals';

/**
 * ESLint Configuration
 *
 * This configuration provides comprehensive linting for TypeScript, React, and Convex code.
 * Formatting is handled by Prettier. ESLint focuses on code quality rules.
 *
 * Key Rules:
 * - @typescript-eslint/no-unused-vars - Detect unused variables
 * - @typescript-eslint/no-explicit-any - Warn on explicit any types
 * - @typescript-eslint/no-non-null-assertion - Disallow force-unwrapping with `!`
 * - @typescript-eslint/no-non-null-asserted-optional-chain - Disallow `foo?.bar!`
 * - no-param-reassign - Prevent parameter reassignment
 * - @typescript-eslint/prefer-as-const - Prefer const assertions
 * - @typescript-eslint/default-param-last - Require default parameters to be last
 * - react/self-closing-comp - Enforce self-closing tags
 * - one-var - Enforce single variable declarations
 * - @typescript-eslint/no-inferrable-types - Disallow explicit types for inferrable values
 * - no-else-return - Disallow unnecessary else blocks
 * - @typescript-eslint/array-type - Enforce consistent array type syntax
 * - no-restricted-syntax (native temporal inputs) - Use DateInput, DateTimeField, or DatePickerField from @/components/ui/date-picker instead of native date/time inputs
 */

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/.convex/**',
      '**/.git/**',
      '.chatroom/**',
      // Convex codegen (any package layout, including services/backend/convex/_generated)
      '**/convex/_generated/**',
      'services/backend/convex/_generated/**',
    ],
  },

  // React "You Might Not Need An Effect" — warns on common unnecessary useEffect patterns
  reactYouMightNotNeedAnEffect.configs.recommended,

  // Base TypeScript configuration for all files
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      '@convex-dev': convexPlugin,
      jsdoc: jsdocPlugin,
      import: importPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // ============================================
      // TypeScript Rules
      // ============================================

      // Detect unused variables
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // Warn on explicit any types
      '@typescript-eslint/no-explicit-any': 'warn',

      // Disallow force-unwrapping possibly null/undefined values (e.g. value!)
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',

      // ============================================
      // Code Style Rules
      // ============================================

      // Prevent parameter reassignment
      'no-param-reassign': 'error',

      // useAsConstAssertion: error
      '@typescript-eslint/prefer-as-const': 'error',

      // useDefaultParameterLast: error
      '@typescript-eslint/default-param-last': 'error',

      // useSelfClosingElements: error
      'react/self-closing-comp': [
        'error',
        {
          component: true,
          html: true,
        },
      ],

      // useSingleVarDeclarator: error
      'one-var': ['error', 'never'],

      // noInferrableTypes: error
      '@typescript-eslint/no-inferrable-types': 'error',

      // noUselessElse: error
      'no-else-return': ['error', { allowElseIf: false }],

      // useConsistentArrayType: error (shorthand syntax like string[] instead of Array<string>)
      '@typescript-eslint/array-type': ['error', { default: 'array' }],

      // ============================================
      // React Hooks rules
      // ============================================
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ============================================
      // Convex-specific rules
      // ============================================
      '@convex-dev/explicit-table-ids': 'error',

      // ============================================
      // Additional recommended rules
      // ============================================
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Prevent hardcoded .js extensions in local imports (relative paths starting with . or ..)
      // Use extensionless imports instead.
      // NOTE: This rule is intentionally scoped — see backend-specific config below.
      // CLI files REQUIRE .js extensions for Node.js ESM compatibility.
      'no-restricted-imports': 'off',

      // ============================================
      // JSDoc rules (enforces cleanup guideline Step 1)
      // Note: These are warnings to encourage documentation without blocking development
      // ============================================
      'jsdoc/require-jsdoc': [
        'off', // Disabled by default - enable when doing cleanup
        {
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
          },
          contexts: [
            'ExportNamedDeclaration > TSInterfaceDeclaration',
            'ExportNamedDeclaration > TSTypeAliasDeclaration',
            'ExportNamedDeclaration > VariableDeclaration[kind="const"]',
          ],
          publicOnly: true,
        },
      ],
      'jsdoc/require-param': 'off', // Enable during cleanup
      'jsdoc/require-param-description': 'off', // Enable during cleanup
      'jsdoc/require-param-type': 'off', // TypeScript handles this
      'jsdoc/require-returns': 'off', // Enable during cleanup
      'jsdoc/require-returns-description': 'off', // Enable during cleanup
      'jsdoc/require-returns-type': 'off', // TypeScript handles this
      'jsdoc/check-tag-names': 'error', // Always validate tag names
      'jsdoc/check-types': 'off', // TypeScript handles this
      'jsdoc/valid-types': 'off', // TypeScript handles this
      'jsdoc/no-undefined-types': 'off', // TypeScript handles this

      // ============================================
      // Import ordering rules (enforces cleanup guideline Step 3)
      // ============================================
      'import/order': [
        'error',
        {
          groups: [
            'builtin', // Node.js built-in modules
            'external', // External packages
            'internal', // Internal modules
            ['parent', 'sibling', 'index'], // Relative imports
          ],
          'newlines-between': 'always', // Allow blank lines between groups
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
      'import/first': 'error',
      'import/newline-after-import': 'error',
      'import/no-duplicates': 'error',

      // ============================================
      // TypeScript-specific rules for better type safety
      // ============================================
      '@typescript-eslint/explicit-function-return-type': 'off', // Too noisy - TypeScript inference is good
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
    },
  },

  // TypeScript files - enable type-aware linting for Convex rules
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: true,
      },
    },
  },

  // JavaScript files - disable TypeScript-specific rules
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
      '@typescript-eslint/prefer-as-const': 'off',
      '@typescript-eslint/default-param-last': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/array-type': 'off',
    },
  },

  // Test files - relaxed rules
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      '**/test/**/*.{ts,tsx}',
      '**/tests/**/*.{ts,tsx}',
    ],
    languageOptions: {
      parserOptions: {
        project: false, // Disable type-aware linting for test files
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },

  // Configuration files
  {
    files: ['*.config.{js,ts,mjs,cjs}', 'postcss.config.mjs'],
    rules: {
      'no-console': 'off',
    },
  },

  // Script files - console.log is expected
  {
    files: ['**/scripts/**/*.{js,ts,mjs,cjs}'],
    rules: {
      'no-console': 'off',
    },
  },

  // Migration files - console.log is expected for debugging migrations
  {
    files: ['**/migration.ts', '**/migrations/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // API callback pages - console.log is expected for debugging OAuth flows
  {
    files: ['**/api/**/callback/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },

  // CLI package - console.log is expected for CLI output
  {
    files: ['**/packages/cli/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },

  // CLI service boundaries — consumers must use each service's public root
  // module instead of reaching into its domain, service, or infrastructure
  // implementation details. The service directories themselves are excluded
  // from this rule so their composition code can wire internal components.
  {
    files: ['packages/cli/src/**/*.{ts,tsx}'],
    ignores: [
      'packages/cli/src/daemon/services/agent-process-service/**',
      'packages/cli/src/daemon/services/task-service/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^(?:\\.\\./)+(?:daemon/)?services/agent-process-service/(?:domain|infrastructure|service)(?:/|$)',
              message:
                'Import agent-process capabilities from daemon/services/agent-process-service/index.js.',
            },
            {
              regex:
                '^(?:\\.\\./)+(?:daemon/)?services/task-service/(?:domain|infrastructure|service)(?:/|$)',
              message: 'Import task capabilities from daemon/services/task-service/index.js.',
            },
          ],
        },
      ],
    },
  },

  // Native date/time inputs render unreliable controls on iOS Safari (dark-mode width,
  // alignment, auto-modified values). Use DatePicker / DatePickerField from
  // @/components/ui/date-picker. See docs/developer/ios-native-date-input.md.
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXAttribute[name.name='type'][value.value=/^(date|datetime-local|month|time|week)$/]",
          message:
            'Native date/time inputs are not allowed. Use DateInput, DateTimeField, DatePicker, or DatePickerField from @/components/ui/date-picker.',
        },
        {
          selector:
            "JSXAttribute[name.name='type'] > JSXExpressionContainer > Literal[value=/^(date|datetime-local|month|time|week)$/]",
          message:
            'Native date/time inputs are not allowed. Use DateInput, DateTimeField, DatePicker, or DatePickerField from @/components/ui/date-picker.',
        },
      ],
    },
  },

  // Raw <input> elements bypass Input's non-temporal type restriction. Render inputs through Input.
  // Warning, not error: Input bakes industrial styling (chatroomIndustrialInputClassName, h-9 w-full
  // text-base) into every render, so migrating the existing file, range, radio, checkbox, search,
  // text and test-mock inputs would restyle product UI without a visual check. Tracked as tech debt;
  // see docs/developer/ios-native-date-input.md#enforcement. Temporal inputs remain an error
  // (no-restricted-syntax above).
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    rules: {
      'react/forbid-elements': [
        'warn',
        {
          forbid: [
            {
              element: 'input',
              message:
                'Use Input from @/components/ui/input (or DatePickerField from @/components/ui/date-picker for dates).',
            },
          ],
        },
      ],
    },
  },

  // Service-to-service direction — agent process management is the lower
  // runtime boundary; task delivery may depend on its public API, but the
  // agent-process service must not depend on task-service internals or API.
  {
    files: ['packages/cli/src/daemon/services/agent-process-service/**/*.{ts,tsx}'],
    ignores: [
      // This application service is the deliberate integration boundary for
      // task work: it coordinates TaskService snapshots with agent lifecycle.
      'packages/cli/src/daemon/services/agent-process-service/service/agent-work-manager.ts',
      'packages/cli/src/daemon/services/agent-process-service/service/agent-work-manager.test.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?:\\.\\./)+task-service(?:/|$)',
              message:
                'Agent-process service must not depend on task-service. Keep task orchestration in task-service.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/cli/src/daemon/services/task-service/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?:\\.\\./)+agent-process-service/(?:domain|infrastructure|service)(?:/|$)',
              message:
                'Task service must use the agent-process service public API at daemon/services/agent-process-service/index.js.',
            },
          ],
        },
      ],
    },
  },

  // Product code must not bypass Input by importing the Base UI primitive, and
  // NativeTemporalInput is for the developer harness only. Relative imports are matched via patterns.
  {
    files: ['apps/webapp/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@base-ui/react/input',
              message: 'Use Input from @/components/ui/input.',
            },
            {
              name: '@base-ui/react',
              importNames: ['Input', 'Field'],
              message:
                'Use Input from @/components/ui/input. Do not render Base UI Field.Control directly.',
            },
            {
              name: '@base-ui/react/field',
              message:
                'Use Input from @/components/ui/input. Do not render Base UI Field.Control directly.',
            },
          ],
          patterns: [
            {
              regex: '(^|/)ui/input$|^\\./input$',
              importNamePattern: '^NativeTemporalInput$',
              message:
                'NativeTemporalInput is for the developer component harness only. Use DatePickerField from @/components/ui/date-picker.',
            },
          ],
        },
      ],
    },
  },

  // Backend (Convex) — enforce extensionless local imports
  // Convex functions use TypeScript compilation and don't need .js extensions.
  // CLI files explicitly need .js for Node.js ESM — that's handled separately.
  {
    files: ['services/backend/convex/**/*.{ts,tsx}', 'services/backend/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['./*.js', '../*.js', '**/*.js'],
              message: 'Do not use .js extensions in import paths. Use extensionless imports.',
            },
          ],
        },
      ],
    },
  },
  // The type test intentionally imports NativeTemporalInput to assert Input rejects it.
  {
    files: ['**/components/ui/input.type-test.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // input.tsx is the one place that wraps the Base UI primitive.
  {
    files: ['**/components/ui/input.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // The developer harness may use NativeTemporalInput. Re-declare the rule with only the Base UI entry,
  // because a flat-config override replaces the rule's options.
  {
    files: ['**/app/developer/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@base-ui/react/input', message: 'Use Input from @/components/ui/input.' },
            {
              name: '@base-ui/react',
              importNames: ['Input', 'Field'],
              message:
                'Use Input from @/components/ui/input. Do not render Base UI Field.Control directly.',
            },
            {
              name: '@base-ui/react/field',
              message:
                'Use Input from @/components/ui/input. Do not render Base UI Field.Control directly.',
            },
          ],
        },
      ],
    },
  },
];
