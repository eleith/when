import { collectDefaultMetrics, Counter, Registry } from 'prom-client';

export const register = new Registry();
register.setDefaultLabels({ app: 'when', service: 'web' });

collectDefaultMetrics({ register });

// Prune low-value default metrics to keep the footprint minimal
const metricsToPrune = [
	'nodejs_active_handles',
	'nodejs_active_handles_total',
	'nodejs_active_requests',
	'nodejs_active_requests_total',
	'nodejs_heap_space_size_total_bytes',
	'nodejs_heap_space_size_used_bytes',
	'nodejs_heap_space_size_available_bytes',
	'nodejs_heap_space_size_bytes_total',
	'nodejs_heap_space_size_bytes_used',
	'nodejs_heap_space_size_bytes_available',
	'nodejs_heap_space_size_bytes_required',
	'nodejs_eventloop_lag_seconds',
	'nodejs_eventloop_lag_min_seconds',
	'nodejs_eventloop_lag_max_seconds',
	'nodejs_eventloop_lag_mean_seconds',
	'nodejs_eventloop_lag_stddev_seconds',
	'nodejs_eventloop_lag_p50_seconds',
	'nodejs_eventloop_lag_p90_seconds',
	'nodejs_eventloop_lag_p99_seconds',
	'process_virtual_memory_bytes',
	'process_virtual_memory_max_bytes',
	'process_heap_bytes',
	'process_start_time_seconds',
	'process_open_fds',
	'process_max_fds'
];

for (const metric of metricsToPrune) {
	register.removeSingleMetric(metric);
}

export const bookingAttemptsTotal = new Counter({
	name: 'when_booking_attempts_total',
	help: 'Total number of visitor booking attempts.',
	labelNames: ['event_type_id', 'status'],
	registers: [register]
});

export const userLoginsTotal = new Counter({
	name: 'when_user_logins_total',
	help: 'Total number of host dashboard login attempts.',
	labelNames: ['provider', 'status'],
	registers: [register]
});

export const icsDownloadsTotal = new Counter({
	name: 'when_ics_downloads_total',
	help: 'Total number of ICS calendar invite downloads.',
	labelNames: ['status'],
	registers: [register]
});
