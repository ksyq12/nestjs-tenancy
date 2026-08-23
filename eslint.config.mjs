import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
  {
    ignores: [
      'dist/',
      'coverage/',
      'test/e2e/generated/',
      'test/e2e/generated-v6-native/',
      'node_modules/',
    ],
  },
);
