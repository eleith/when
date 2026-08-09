import { describe, expect, test, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigEditor } from './editor.js';

describe('ConfigEditor', () => {
	const tempPath = join(process.cwd(), 'temp-editor-test.yaml');

	afterEach(() => {
		try {
			unlinkSync(tempPath);
		} catch {
			/* ignore */
		}
	});

	test('gets and sets nested values using dot notation', () => {
		const initialYaml = `
auth:
  credentials:
    username: "admin"
calendars:
  - id: "work"
    type: "caldav"
`;
		writeFileSync(tempPath, initialYaml);

		const editor = new ConfigEditor(tempPath);

		// Get tests
		expect(editor.get('auth.credentials.username')).toBe('admin');
		expect(editor.get('calendars.0.id')).toBe('work');
		expect(editor.get('nonexistent.path')).toBeUndefined();

		// Set tests
		editor.set('auth.credentials.username', 'superadmin');
		editor.set('calendars.0.type', 'google');
		editor.set('calendars.1', { id: 'personal', type: 'caldav' });
		editor.set('newSection.value', 42);

		const result = readFileSync(tempPath, 'utf8');

		expect(result).toContain('username: "superadmin"');
		expect(result).toContain('type: "google"');
		expect(result).toContain('id: personal');
		expect(result).toContain('value: 42');
	});

	test('creates intermediate structures automatically', () => {
		// Start with empty file
		writeFileSync(tempPath, '');

		const editor = new ConfigEditor(tempPath);
		editor.set('deeply.nested.property.value', 'hello');

		const result = readFileSync(tempPath, 'utf8');
		expect(result).toContain('deeply:');
		expect(result).toContain('nested:');
		expect(result).toContain('property:');
		expect(result).toContain('value: hello');
	});

	test('deletes a key and leaves siblings intact', () => {
		const initialYaml = `
user:
  appearance:
    font_name: "My Font"
    font_path: "https://example.com/my-font.woff2"
`;
		writeFileSync(tempPath, initialYaml);

		const editor = new ConfigEditor(tempPath);
		editor.delete('user.appearance.font_path');

		expect(editor.get('user.appearance.font_path')).toBeUndefined();
		expect(editor.get('user.appearance.font_name')).toBe('My Font');

		// deleting a missing key is a no-op, not an error
		expect(() => editor.delete('user.appearance.missing')).not.toThrow();
	});

	test('preserves comments and formatting', () => {
		const initialYaml = `
# This is a root comment
auth:
  # Credentials block
  credentials:
    username: "admin" # Inline comment
`;
		writeFileSync(tempPath, initialYaml);

		const editor = new ConfigEditor(tempPath);
		editor.set('auth.credentials.password', 'secret');

		const result = readFileSync(tempPath, 'utf8');

		expect(result).toContain('# This is a root comment');
		expect(result).toContain('# Credentials block');
		expect(result).toContain('username: "admin" # Inline comment');
		expect(result).toContain('password: secret');
	});
});
