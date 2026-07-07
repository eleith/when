import type { WhenConfiguration } from '@when/config';

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
	services: [
		{
			id: 'google-service',
			type: 'google',
			client_id: 'gc-id',
			client_secret: 'gc-secret',
			refresh_token: 'gc-token'
		}
	],
	video_chats: [
		{
			id: 'my-google-meet',
			type: 'google-meet',
			service_id: 'google-service'
		}
	],
	calendars: [
		{
			id: 'my-google-cal',
			type: 'google',
			service_id: 'google-service',
			google_calendar_id: 'gc-calid'
		}
	],
	availabilities: [
		{
			id: 'standard',
			weekly: {
				monday: ['09:00-17:00'],
				tuesday: ['09:00-17:00'],
				wednesday: ['09:00-17:00'],
				thursday: ['09:00-17:00'],
				friday: ['09:00-17:00']
			}
		}
	],
	event_types: [
		{
			id: '30-min-chat',
			name: '30 Minute Chat',
			duration: 30,
			slug: '30-min',
			appointment_flow: 'auto',
			destination_calendar: 'my-google-cal',
			availability: 'standard'
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
