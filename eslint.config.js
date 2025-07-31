import init from 'eslint-config-metarhia';

export default [
  ...init,
  {
    languageOptions: {
      sourceType: 'module',
      globals: {
        Notification: 'readonly',
        navigator: 'readonly',
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        self: 'readonly',
      },
    },
  },
];
