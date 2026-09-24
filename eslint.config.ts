import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import { defineConfig } from 'eslint/config';

export default defineConfig([
    {
        ignores: [
            '**/dist/**',
            '**/dist-ssr/**',
            '**/node_modules/**',
            '**/.git/**',
            '**/*.local',
        ],
    },
    {
        files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'],
        plugins: { js },
        extends: [
            'js/recommended',
        ],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    'argsIgnorePattern': '^_',
                    'varsIgnorePattern': '^_',
                },
            ],
            '@typescript-eslint/consistent-type-imports': [
                'warn',
                {
                    prefer: 'type-imports',
                    fixStyle: 'inline-type-imports',
                },
            ],
            indent: [
                'warn',
                4,
                {
                    SwitchCase: 1,
                },
            ],
            semi: [
                'error',
                'always',
            ],
            quotes: [
                'error',
                'single',
                {
                    'avoidEscape': true,
                    'allowTemplateLiterals': true,
                },
            ],
            'comma-dangle': [
                'warn',
                'always-multiline',
            ],
        },
    },
    tseslint.configs.recommended,
    pluginVue.configs['flat/essential'],
    {
        files: ['**/*.vue'],
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser,
            },
        },
    },
]);