import exampleYaml from '../../../../config.example.yaml?raw';

export { exampleYaml };

export async function writeExampleConfig(destPath: string): Promise<void> {
	await Bun.write(destPath, exampleYaml);
}
