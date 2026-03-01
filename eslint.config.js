// @ts-check

import pluginJs from '@eslint/js';
import configPrettier from 'eslint-config-prettier';
import pluginNoOnlyTests from 'eslint-plugin-no-only-tests';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import pluginTypescript from 'typescript-eslint';

export default defineConfig([
    globalIgnores(['**/dist/', '**/dist-engine/', 'packages/engineer/gui-feature.d.ts']),
    pluginJs.configs.recommended,
    pluginReactHooks.configs.flat.recommended,

    { plugins: { 'no-only-tests': pluginNoOnlyTests } },
    {
        rules: {
            // 'no-console': 'error',
            'no-empty-pattern': 'off',
            'no-only-tests/no-only-tests': 'error',
            'no-undef': 'off',
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'react-hooks/exhaustive-deps': 'error',
        },
    },
    ...pluginTypescript.configs.recommendedTypeChecked.map((config) => ({
        ...config,
        files: ['**/*.{ts,tsx,mts,cts}'],
    })),
    { languageOptions: { parserOptions: { projectService: true } } },
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        rules: {
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/no-unused-expressions': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@typescript-eslint/restrict-template-expressions': 'off',
            '@typescript-eslint/unbound-method': 'off',
        },
    },
    configPrettier,
]);
