import { text, isCancel } from '@clack/prompts';
import { SmtpSchema } from '@when/config';
import { schemaDefault } from '../utils/schema-defaults.ts';
import { envRef } from '../utils/env-ref.ts';
import type { SectionResult } from './auth.ts';

const SMTP_PASS_VAR = 'WHEN_SMTP_PASS';

export async function promptSmtp(): Promise<SectionResult | null> {
	const host = await text({
		message: 'SMTP host:',
		placeholder: 'smtp.example.com',
		validate(v) {
			if (!v || !v.trim()) return 'Host is required';
		}
	});
	if (isCancel(host)) return null;

	const portDefault = schemaDefault<number>(SmtpSchema, 'port');
	const portVal = await text({
		message: 'SMTP port:',
		placeholder: String(portDefault),
		defaultValue: String(portDefault),
		validate(v) {
			const s = (v ?? '').trim();
			if (!s) return;
			if (!/^\d+$/.test(s)) return 'Must be a whole number';
			const n = Number(s);
			if (n < 1 || n > 65535) return 'Must be between 1 and 65535';
		}
	});
	if (isCancel(portVal)) return null;
	const port = portVal.trim() ? Number(portVal.trim()) : portDefault;

	const user = await text({
		message: 'SMTP username:',
		validate(v) {
			if (!v || !v.trim()) return 'Username is required';
		}
	});
	if (isCancel(user)) return null;

	const fromVal = await text({
		message: 'From address (optional, blank uses noreply@<your url domain>):',
		placeholder: ''
	});
	if (isCancel(fromVal)) return null;

	const value: Record<string, unknown> = {
		host: host.trim(),
		port,
		user: user.trim(),
		pass: envRef(SMTP_PASS_VAR)
	};
	const from = fromVal.trim();
	if (from) value.from = from;

	return { value, envVars: [SMTP_PASS_VAR] };
}
