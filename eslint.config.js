// ESLint flat config (DX-008): strict TS + Prettier compatibility
//
// Legacy code: many rules are warnings so CI stays green while surfacing
// issues. New code should aim for zero warnings.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'service-catalog/**', 'coverage/**', 'data/**', '.tmp*/**', 'src/types/transformers.d.ts'],
  },
  {
    ...js.configs.recommended,
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off',
      // Legacy-friendly: stylistic issues are warnings, not blockers
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      'no-useless-assignment': 'warn',
      'prefer-const': 'off',
      'preserve-caught-error': 'off',
    },
  },
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'prefer-const': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-undef': 'off',
    },
  },
);
