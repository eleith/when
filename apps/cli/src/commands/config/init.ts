import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { define } from 'gunshi';
import { getValidatedConfigPath } from '../../utils/config-path.ts';
import { pass, fail } from '../../utils/report.ts';

const SKELETON = `# yaml-language-server: $schema=http://localhost:3000/schema.json
# Adjust the schema URL to your running app's address.
# Edit the example values and fill all three blank passwords below, then run:
# when-cli config validate
# No .env file is required. Environment interpolation is an advanced option.
# Keep this file private: it contains your passwords.
# Full example: https://git.eleith.com/eleith/when/raw/branch/main/docs/when.example.yaml
auth:
  # Optional auth.secret: a random string of at least 32 characters.
  # Omit it for a random secret each startup; restarts will sign you out.
  credentials:
    username: admin
    password: '' # Required: choose your own admin password.
user:
  name: Your Name
  email: you@example.com
  timezone: UTC
smtp:
  host: smtp.example.com
  username: smtp-user
  password: '' # Required: your SMTP password.
providers:
  my-caldav:
    type: caldav
    url: https://dav.example.com/
    username: dav-user
    password: '' # Required: your CalDAV password (or app password).
    calendars:
      primary:
        href: calendars/dav-user/primary/
schedules:
  standard: {} # Defaults to Monday-Friday, 09:00-17:00 in user.timezone.
meetings:
  30-min:
    title: 30 minute meeting
    booking_calendar: primary
    schedule: standard
url:
  app: https://book.example.com # Your public HTTPS URL behind a trusted reverse proxy.
`;

export const initCommand = define({
	name: 'init',
	description: 'Write a minimal starter when.yaml',
	args: {
		config: {
			type: 'string',
			short: 'c',
			description: 'Path to write when.yaml (defaults to the standard config location)'
		}
	},
	run(ctx) {
		const path = getValidatedConfigPath(ctx.values?.config);
		if (existsSync(path)) {
			fail(`${path} already exists — move or remove it, or pass a different -c path`);
			return;
		}

		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, SKELETON, { mode: 0o600, flag: 'wx' });

		pass(`wrote ${path}`);
		console.log(
			'  edit the example values and fill all three blank passwords, then run: when-cli config validate'
		);
		console.log(
			'  see https://git.eleith.com/eleith/when/src/branch/main/docs/when.example.yaml for every option'
		);
	}
});
