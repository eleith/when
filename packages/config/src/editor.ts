import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import YAML from 'yaml';

export class ConfigEditor {
	private doc: YAML.Document;

	constructor(private configPath: string) {
		const content = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
		this.doc = YAML.parseDocument(content);
	}

	private parsePath(path: string): (string | number)[] {
		return path.split('.').map((k) => {
			const num = Number(k);
			return Number.isNaN(num) ? k : num;
		});
	}

	get(path: string): unknown {
		const keys = this.parsePath(path);
		const node = this.doc.getIn(keys);
		if (node === undefined || node === null) {
			return undefined;
		}
		if (typeof node === 'object' && 'toJSON' in node) {
			return (node as { toJSON: () => unknown }).toJSON();
		}
		return node;
	}

	set(path: string, value: unknown): void {
		const keys = this.parsePath(path);
		this.doc.setIn(keys, value);
		writeFileSync(this.configPath, this.doc.toString());
	}
}
