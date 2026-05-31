//
// Usage:
//   pnpm hash-password
//     — interactive: prompts for the password (input hidden), Enter to submit.
//
//   printf 'pw' | pnpm hash-password
//     — non-interactive: reads stdin to end. Useful in scripts.
import { hash as hashArgon2, Algorithm } from '@node-rs/argon2';

async function readFromTty(prompt: string): Promise<string> {
	process.stderr.write(prompt);
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding('utf8');

	return new Promise((resolve) => {
		let pw = '';
		const onData = (chunk: string) => {
			for (const ch of chunk) {
				const code = ch.charCodeAt(0);
				if (code === 0x03) {
					// Ctrl-C
					process.stderr.write('\n');
					process.stdin.setRawMode(false);
					process.stdin.pause();
					process.exit(130);
				}
				if (code === 0x0d || code === 0x0a) {
					// Enter
					process.stderr.write('\n');
					process.stdin.off('data', onData);
					process.stdin.setRawMode(false);
					process.stdin.pause();
					resolve(pw);
					return;
				}
				if (code === 0x08 || code === 0x7f) {
					// Backspace
					if (pw.length > 0) pw = pw.slice(0, -1);
					continue;
				}
				if (code < 0x20) continue; // ignore other control chars
				pw += ch;
			}
		};
		process.stdin.on('data', onData);
	});
}

async function readFromPipe(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

const raw = process.stdin.isTTY ? await readFromTty('Password: ') : await readFromPipe();
if (!raw) {
	console.error('no password provided');
	process.exit(1);
}

const hash = await hashArgon2(raw, { algorithm: Algorithm.Argon2id });
console.log(hash);
