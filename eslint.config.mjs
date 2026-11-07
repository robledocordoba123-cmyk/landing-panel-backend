import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['node_modules', 'coverage']),
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: {
      // Un manejador de errores de Express necesita sus 4 argumentos aunque no use el último.
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^next$', ignoreRestSiblings: true }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': ['error', { allow: ['error', 'log'] }],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
]);
