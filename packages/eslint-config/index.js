// @isp/eslint-config — permissive flat config for Batch 0
// Do not enable strict rules like noUnusedLocals yet; Batch 0 is about getting a green lint gate, not reformatting the world.

import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      // Permissive for Batch 0 — audit found many `any` and unused vars; don't bury real fixes in lint noise.
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-unused-vars': 'off',
      'prefer-const': 'off',
    },
  },
  {
    ignores: ['dist/**', '.next/**', 'node_modules/**', '.turbo/**', 'coverage/**', '*.config.*', 'prisma/**'],
  },
];
