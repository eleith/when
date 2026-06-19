import type { WhenConfiguration } from '@when/config';

export const validConfig: WhenConfiguration = {
	auth: {
		credentials: {
			username: 'admin',
			password_hash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def'
		}
	},
	user: {
		name: 'Jane Doe',
		timezone: 'America/New_York',
		email: 'jane@example.com',
		branding: {
			color: {
				primary: {
					light: '#4f46e5',
					dark: '#818cf8'
				}
			}
		}
	},
	smtp: {
		host: 'smtp.example.com',
		port: 587,
		user: 'mailer',
		pass: 'secret'
	},
	calendars: [
		{
			id: 'my-google-cal',
			type: 'google',
			client_id: 'gc-id',
			client_secret: 'gc-secret',
			refresh_token: 'gc-token',
			google_calendar_id: 'gc-calid'
		}
	],
	availability: {
		default: {
			monday: ['09:00-17:00'],
			tuesday: ['09:00-17:00'],
			wednesday: ['09:00-17:00'],
			thursday: ['09:00-17:00'],
			friday: ['09:00-17:00']
		}
	},
	event_types: [
		{
			id: '30-min-chat',
			name: '30 Minute Chat',
			duration: 30,
			slug: '30-min',
			appointment_flow: 'auto',
			destination_calendar: 'my-google-cal'
		}
	],
	database: {
		app: './data/when.sqlite',
		queue: './data/openworkflow.sqlite'
	},
	url: { app: 'localhost:3000', internal: 'http://localhost:3000' }
};
