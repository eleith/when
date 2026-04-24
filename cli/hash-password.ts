#!/usr/bin/env bun
//
// Usage:
//   echo 'your-password' | bun run hash-password
//   bun run hash-password          # then type password, Ctrl-D to end
//
// Tip: in a shell, prefer `read -rs pw && printf %s "$pw" | bun run hash-password`
// so the password is not stored in shell history.

const raw = (await Bun.stdin.text()).replace(/\r?\n$/, '');
if (!raw) {
	console.error('no password on stdin');
	process.exit(1);
}

const hash = await Bun.password.hash(raw, { algorithm: 'argon2id' });
console.log(hash);
