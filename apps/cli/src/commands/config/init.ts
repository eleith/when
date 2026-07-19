import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { define } from 'gunshi';
import { getValidatedConfigPath } from '../../utils/config-path.ts';
import { pass, fail } from '../../utils/report.ts';

const SKELETON = `# yaml-language-server: $schema=../../../packages/config/src/config.schema.json
# Minimal starter config. Edit the placeholders, set the \${...} env vars, then
# run: when-cli config validate. See config/when.example.yml for every option.
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
  user: smtp-user
  pass: \${WHEN_SMTP_PASS}
services:
  - name: my-caldav
    type: caldav
    url: https://dav.example.com/
    username: dav-user
    password: \${WHEN_SERVICE_MY_CALDAV_PASSWORD}
calendars:
  - name: primary
    type: caldav
    service: my-caldav
    path: calendars/dav-user/primary/
schedules:
  - name: standard
    weekly:
      - days: [mon, tue, wed, thu, fri]
        from: '09:00'
        to: '17:00'
meetings:
  - name: 30 minute meeting
    slug: 30-min
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
		console.log('  see config/when.example.yml for every option');
	}
});
