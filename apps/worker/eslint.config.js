import js from '@eslint/js';
import ts from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default ts.config(
	{ ignores: ['build/', 'dist/', 'coverage/'] },
	js.configs.recommended,
	...ts.configs.recommended,
	prettier,
	{
		files: ['src/**/*.ts'],
		ignores: ['src/metrics/**', 'src/**/*.test.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['@prometheus-io/client', '@prometheus-io/client/*', '**/metrics/registry*'],
							message:
								'Keep Prometheus details inside metrics; wire an operation observer at the service boundary.'
						}
					]
				}
			]
		}
	},
	{
		languageOptions: { globals: { ...globals.node } },
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			]
		}
	}
);
