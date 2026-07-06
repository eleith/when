import { ConfigEditor } from '@when/config';

export function getExistingIds(configPath: string, key: 'calendars' | 'video_chats' | 'services'): string[] {
	try {
		const editor = new ConfigEditor(configPath);
		const items = (editor.get(key) as { id: string }[]) ?? [];
		return items.map((item) => item.id);
	} catch {
		return [];
	}
}
