import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { define } from 'gunshi';
import { getValidatedConfigPath } from '../../utils/config-path.ts';
import { pass, fail } from '../../utils/report.ts';

const SKELETON = `# yaml-language-server: $schema=http://localhost:3000/schema.json
# Adjust the schema URL to your running app's address.
# Edit the placeholders and set the \${...} env vars, then run: when-cli config validate.
# Full example: https://git.eleith.com/eleith/when/raw/branch/main/docs/when.example.yaml
auth:
  credentials:
    username: admin
    password: \${WHEN_ADMIN_PASSWORD}
user:
  name: Your Name
  email: you@example.com
  timezone: UTC
smtp:
  host: smtp.example.com
  port: 587
  username: smtp-user
  password: \${WHEN_SMTP_PASSWORD}
providers:
  my-caldav:
    type: caldav
    url: https://dav.example.com/
    username: dav-user
    password: \${WHEN_PROVIDER_MY_CALDAV_PASSWORD}
    calendars:
      primary:
        href: calendars/dav-user/primary/
schedules:
  standard:
    weekly:
      - days: [mon, tue, wed, thu, fri]
        from: '09:00'
        to: '17:00'
meetings:
  30-min:
    title: 30 minute meeting
    duration_minutes: 30
    booking_calendar: primary
    schedule: standard
database:
  app: ./data/when.sqlite
  queue: ./data/openworkflow.sqlite
url:
  app: https://book.example.com
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
		writeFileSync(path, SKELETON);

		pass(`wrote ${path}`);
		console.log('  edit the placeholders, then run: when-cli config validate');
		console.log(
			'  see https://git.eleith.com/eleith/when/src/branch/main/docs/when.example.yaml for every option'
		);
	}
});
