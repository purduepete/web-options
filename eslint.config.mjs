import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**', 'data/**', '.run/**', '.secrets/**', 'docs/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
            ],
        },
    },
    {
        files: ['backend/**/*.ts', 'shared/**/*.ts', 'scripts/**/*.{js,mjs}', '*.config.ts', 'frontend/vite.config.ts'],
        languageOptions: { globals: globals.node },
    },
    {
        files: ['frontend/src/**/*.{ts,tsx}', 'frontend/test/**/*.{ts,tsx}', 'frontend/public/**/*.js'],
        languageOptions: { globals: globals.browser },
        plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
            'no-console': ['warn', { allow: ['warn', 'error'] }],
        },
    },
    {
        // Providers and pages that also export their hook or a pure helper.
        files: [
            'frontend/src/**/*Provider.tsx',
            'frontend/src/components/Toasts.tsx',
            'frontend/src/pages/FavoritesPage.tsx',
        ],
        rules: { 'react-refresh/only-export-components': 'off' },
    }
);
