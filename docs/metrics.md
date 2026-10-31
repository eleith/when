# Metrics

One scrape, at web's `/metrics`. Web fetches the worker over private HTTP and
returns both. No database queries. No public worker port.

Enable `prometheus.enabled` and set `prometheus.token` in
[`when.yaml`](config.md#prometheus). Send `Authorization: Bearer <token>` when
scraping. Turning the endpoint off does not stop the application counters.

## Is it up?

Prometheus `up` checks the web endpoint. `when_worker_scrape_success` is 1 if web
collected the worker's metrics, 0 otherwise. Web waits up to two seconds. If the
worker fails, the response is still HTTP 200, with web metrics only. Old worker
samples are not kept.

That checks reachability, not whether jobs are making progress or email works.

Application metrics carry `app="when"` and `service="web"|"worker"`; the
scrape-success flag has only `app`. There are no Node collectors or background
sampling timers. Use host or container monitoring for CPU and memory.

## Appointments

`when_appointment_operations_total{action,actor,status}` counts operation outcomes:

- `create`, `cancel`, `reschedule`: host or guest.
- `accept`, `decline`: host.
- `expire`: system.

Status is `success`, `rejected` or `error`. Bulk actions count each operation.
Expiry counts one invocation, even if there were no rows to expire. Rescheduling
counts once, not as another creation.

These are not committed-row counts. If a write succeeds but enqueueing fails,
the operation counts as an error. Use the database for saved appointment totals.

Booking attempts, logins and ICS requests keep their own counters. These are
not unique-user counts. Booking failures use `invalid_input`, `slot_taken` or
`error`; an error is not necessarily a database failure. Booking counts explicit
validation, availability and creation outcomes, not every HTTP failure.

## Jobs

| Metric                                     | What it measures                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `when_jobs_active{job_name}`               | Handlers executing now. Zero when idle.                                |
| `when_job_oldest_active_seconds{job_name}` | How long the oldest active handler has been executing. Zero when idle. |
| `when_job_duration_seconds{job_name}`      | Duration of each handler execution.                                    |
| `when_jobs_total{job_name,status}`         | Executions that `returned` or `escaped`.                               |

Waiting workflows aren't active handlers. A handler can escape normally to wait
for a child workflow, so `escaped` does **not** mean failed. Durations exclude
parked time; they don't measure the workflow's full lifetime.

These signals show activity without reading the queue database. They don't tell
you the backlog or how many workflows finished or failed. Use queue history for
that.

## Failures

`when_operation_failures_total{operation,code}` groups failed attempts:

| Operation                           | Codes                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `worker_scrape`                     | `unauthorized`, `http_error`, `timeout`, `transport_error`, `invalid_snapshot` |
| `smtp_send`                         | `auth`, `timeout`, `connection`, `rejected`, `unknown`                         |
| `calendar_refresh`                  | `provider_error`                                                               |
| `calendar_write`, `calendar_delete` | `not_configured`, `provider_error`                                             |

Retries are new attempts. SMTP failures include test emails; `when_emails_total`
counts appointment sends only. A successful send is not proof of inbox delivery.
Calendar provider errors aren't split further. Write/delete failures include
calendar calls made by reconciliation, video booking, cleanup and purge. Details
belong in logs and admin history, not labels.

Calendar refresh counters report import outcomes. Calendar sync counters report
scan outcomes, not every remote write. Sync duration measures one appointment's
reconciliation, not the whole scan.

Counters reset on restart. Use Prometheus rates or increases, not raw totals as
an audit trail.

## Code placement

Prometheus code lives in web's `src/lib/server/metrics/` and worker's `src/metrics/`.
Public operation facades and startup wire the observers. HTTP routes call typed
outcome recorders at known decision points, rather than wrapping handlers or
inferring outcomes from response codes. Domain implementations do not record
metrics. Lint rejects direct Prometheus and registry imports outside those areas.
