import { text, isCancel } from '@clack/prompts';
import { UserSchema } from '@when/config';
import { schemaDefault } from '../utils/schema-defaults.ts';
import type { SectionResult } from './auth.ts';

export async function promptUser(): Promise<SectionResult | null> {
	const name = await text({
		message: "Schedule owner's display name:",
		validate(v) {
			if (!v || !v.trim()) return 'Name is required';
		}
	});
	if (isCancel(name)) return null;

	const email = await text({
		message: "Schedule owner's email:",
		validate(v) {
			if (!v || !v.trim()) return 'Email is required';
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return 'Must be a valid email';
		}
	});
	if (isCancel(email)) return null;

	const tzDefault = schemaDefault<string>(UserSchema, 'timezone');
	const timezone = await text({
		message: 'Timezone (IANA, e.g. America/New_York):',
		placeholder: tzDefault,
		defaultValue: tzDefault
	});
	if (isCancel(timezone)) return null;

	return {
		value: { name: name.trim(), email: email.trim(), timezone: timezone.trim() },
		envVars: []
	};
}
