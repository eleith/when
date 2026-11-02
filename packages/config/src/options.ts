export type ConfigEnvironment = Readonly<Record<string, string | undefined>>;

export interface ConfigLoadOptions {
	readonly env?: ConfigEnvironment;
}

export interface ConfigPathOptions extends ConfigLoadOptions {
	readonly cwd?: string;
}
