import path from 'node:path';

const DOC = 'docs/application/design/theme.md (Feedback & Notifications)';

/** Toast libraries. A specifier matches when it equals the package name or is a subpath of it. */
const TOAST_PACKAGES = [
  'sonner',
  'react-hot-toast',
  'react-toastify',
  '@radix-ui/react-toast',
  '@base-ui/react/toast',
];

/** shadcn toast modules, matched by path suffix so any alias (@/, ~/, none) or relative form matches. */
const TOAST_MODULE_SUFFIXES = [
  'components/ui/toast',
  'components/ui/toaster',
  'components/ui/sonner',
  'hooks/use-toast',
];

const SCRIPT_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;

function isToastPackage(specifier) {
  return TOAST_PACKAGES.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
}

function endsWithToastModule(modulePath) {
  return TOAST_MODULE_SUFFIXES.some(
    (suffix) => modulePath === suffix || modulePath.endsWith(`/${suffix}`)
  );
}

function isRelative(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function isToastSpecifier(specifier, filename) {
  if (isToastPackage(specifier)) return true;
  if (isRelative(specifier)) {
    const resolved = path
      .resolve(path.dirname(filename), specifier)
      .split(path.sep)
      .join('/')
      .replace(SCRIPT_EXTENSION, '');
    return endsWithToastModule(resolved);
  }
  return endsWithToastModule(specifier);
}

/** @type {import('eslint').Rule.RuleModule} */
const noToast = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow toast components and toast libraries. Show feedback inline instead.',
    },
    schema: [],
    messages: {
      noToast:
        'Toasts are not allowed (imported "{{source}}"). Show feedback inline: field errors beside the field, action failures as role="alert" text beside the control, page or card failures with Alert from @/components/ui/alert. See ' +
        DOC +
        '.',
    },
  },
  create(context) {
    const { filename } = context;

    /** @param {import('eslint').Rule.Node | null | undefined} sourceNode */
    function checkSource(sourceNode) {
      if (!sourceNode || sourceNode.type !== 'Literal' || typeof sourceNode.value !== 'string') {
        return;
      }
      if (isToastSpecifier(sourceNode.value, filename)) {
        context.report({
          node: sourceNode,
          messageId: 'noToast',
          data: { source: sourceNode.value },
        });
      }
    }

    return {
      ImportDeclaration: (node) => checkSource(node.source),
      ExportNamedDeclaration: (node) => checkSource(node.source),
      ExportAllDeclaration: (node) => checkSource(node.source),
      ImportExpression: (node) => checkSource(node.source),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          checkSource(node.arguments[0]);
        }
      },
    };
  },
};

export default noToast;
