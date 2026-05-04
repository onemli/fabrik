module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh', 'unused-imports'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    }],
    'unused-imports/no-unused-imports': 'error',
    'no-restricted-syntax': [
      'warn',
      {
        selector: "CallExpression[callee.property.name='toLocaleDateString']",
        message: 'Use formatDate() from useFormatters() or TimezoneContext instead.',
      },
      {
        selector: "CallExpression[callee.property.name='toLocaleTimeString']",
        message: 'Use formatTime() from useFormatters() or TimezoneContext instead.',
      },
    ],
  },
}
