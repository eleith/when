const ENV_REF = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

export class MissingEnvVarsError extends Error {
	readonly missing: readonly string[];
	constructor(missing: string[]) {
		super(`config.yaml references unset environment variables: ${missing.join(', ')}`);
		this.name = 'MissingEnvVarsError';
		this.missing = [...missing];
	}
}

export function interpolate<T>(node: T, env: NodeJS.ProcessEnv = process.env): T {
	const missing = new Set<string>();
	const result = walk(node, env, missing);
	if (missing.size > 0) {
		throw new MissingEnvVarsError([...missing].sort());
	}
	return result as T;
}

function walk(node: unknown, env: NodeJS.ProcessEnv, missing: Set<string>): unknown {
	if (typeof node === 'string') {
		return node.replace(ENV_REF, (_, name: string) => {
			const value = env[name];
			if (value === undefined) {
				missing.add(name);
				return '';
			}
			return value;
		});
	}
	if (Array.isArray(node)) {
		return node.map((n) => walk(n, env, missing));
	}
	if (node !== null && typeof node === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(node)) {
			out[k] = walk(v, env, missing);
		}
		return out;
	}
	return node;
}
