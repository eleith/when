import { ConfigEditor } from '@when/config';

export function getExistingNames(configPath: string, key: 'calendars' | 'services'): string[] {
	try {
		const editor = new ConfigEditor(configPath);
		const items = (editor.get(key) as { name: string }[]) ?? [];
		return items.map((item) => item.name);
	} catch {
		return [];
	}
}
