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
	providers: {
		'google-service': {
			type: 'google',
			client_id: 'gc-id',
			client_secret: 'gc-secret',
			calendars: {
				'my-google-cal': { id: 'gc-calid', sync: { refresh_every_minutes: 10 } }
			}
		}
	},
	schedules: {
		standard: {
			weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }]
		}
	},
	meetings: {
		'30-min-chat': {
			title: '30 minute chat',
			duration_minutes: 30,
			additional_duration_minutes: [],
			require_approval: false,
			booking_calendar: 'my-google-cal',
			schedule: 'standard',
			visibility: 'public',
			additional_busy_calendars: [],
			show_slots: false,
			notice_minutes: 120,
			booking_window_days: 60,
			padding_before_minutes: 0,
			padding_after_minutes: 0,
			daily_booking_limit: null
		}
	},
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
