import type { WhenConfiguration } from '../schema.js';

export const validConfig: WhenConfiguration = {
	auth: {
		credentials: {
			username: 'admin',
			password: 'my-password'
		}
	},
	user: {
		name: 'Jane Doe',
		timezone: 'America/New_York',
		email: 'jane@example.com',
		appearance: {
			title: 'if not now, when?',
			description: 'find some time and we can meet',
			logo_url: '/logo.svg',
			avatar_url: '/avatar.svg',
			favicon_url: '/favicon.svg',
			primary_light_color: '#4f46e5',
			primary_dark_color: '#818cf8',
			background_light_color: '#f5f5f5',
			background_dark_color: '#0a0a0a',
			text_light_color: '#171717',
			text_dark_color: '#ededed'
		}
	},
	smtp: {
		host: 'smtp.example.com',
		port: 587,
		user: 'mailer',
		pass: 'secret'
	},
	services: [
		{
			name: 'google-service',
			type: 'google',
			client_id: 'gc-id',
			client_secret: 'gc-secret',
			refresh_token: 'gc-token'
		}
	],
	calendars: [
		{
			name: 'my-google-cal',
			type: 'google',
			service: 'google-service',
			google_calendar_id: 'gc-calid'
		}
	],
	schedules: [
		{
			name: 'standard',
			weekly: {
				monday: ['09:00-17:00'],
				tuesday: ['09:00-17:00'],
				wednesday: ['09:00-17:00'],
				thursday: ['09:00-17:00'],
				friday: ['09:00-17:00']
			}
		}
	],
	meetings: [
		{
			name: '30-min-chat',
			duration_minutes: 30,
			slug: '30-min',
			booking_approval: 'instant',
			booking_calendar: 'my-google-cal',
			schedule: 'standard'
		}
	],
	database: {
		app: './data/when.sqlite',
		queue: './data/openworkflow.sqlite'
	},
	url: {
		app: 'localhost:3000',
		internal: 'http://localhost:3000',
		worker: 'http://localhost:9000'
	},
	prometheus: {
		enabled: false,
		secret: 'test-token'
	}
};
