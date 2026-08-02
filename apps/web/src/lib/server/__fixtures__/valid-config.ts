import type { WhenConfiguration } from '@when/config';

export const validConfig: WhenConfiguration = {
	version: 1,
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
			app_icon_url: '/assets/images/app-icon.svg',
			avatar_url: '/assets/images/avatar.svg',
			favicon_url: '/assets/images/favicon.svg',
			opengraph_url: '/assets/images/opengraph.png',
			primary_light_color: '#4f46e5',
			primary_dark_color: '#818cf8',
			background_light_color: '#f5f5f5',
			background_dark_color: '#0a0a0a',
			text_light_color: '#171717',
			font_name: 'Noto Sans',
			text_dark_color: '#ededed'
		}
	},
	smtp: {
		host: 'smtp.example.com',
		port: 587,
		user: 'mailer',
		pass: 'secret'
	},
	providers: [
		{
			name: 'google-service',
			type: 'google',
			client_id: 'gc-id',
			client_secret: 'gc-secret'
		}
	],
	calendars: [
		{
			name: 'my-google-cal',
			type: 'google',
			provider: 'google-service',
			google_calendar_id: 'gc-calid'
		}
	],
	schedules: [
		{
			name: 'standard',
			weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }]
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
		worker: 'http://when-worker:9000'
	},
	prometheus: { enabled: false, secret: '' }
};
