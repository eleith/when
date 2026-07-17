export function pass(message: string): void {
	console.log(`✅ ${message}`);
}

export function fail(message: string): void {
	console.error(`❌ ${message}`);
	process.exitCode = 1;
}

export function detail(line: string): void {
	console.error(`   ${line}`);
}
