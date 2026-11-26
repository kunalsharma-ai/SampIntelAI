# Operations

## Health

| Endpoint | Meaning | Use for |
|---|---|---|
| `GET /api/v1/health/live` | The process answers | Liveness probe: restart if it fails |
| `GET /api/v1/health/ready` | The database answers within 2 s (503 otherwise) | Readiness probe and load balancer |
| `GET /api/v1/health` | Status, database and version | People and dashboards |

## Metrics

`GET /api/v1/metrics` serves Prometheus text when called with `Authorization: Bearer $METRICS_TOKEN`; without the
token it answers 401, and with no token configured it answers 404. Route labels are route patterns
(`/api/v1/projects/:id`), never raw paths, so ids never become label values.

| Metric | Alert when |
|---|---|
| `si_http_requests_total{status}` | 5xx above 1% of requests for 5 minutes |
| `si_http_request_duration_seconds` | p95 above 500 ms for 10 minutes |
| `si_qa_worker_runs_total{result}` | any `failed` |
| `si_qa_worker_last_success_timestamp_seconds` | older than 5 × `QA_TICK_SECONDS` |
| `si_process_*`, `si_nodejs_*` | resident memory or event loop lag rising steadily |

## Logs

Production logs are one JSON object per line (`LOG_FORMAT=json`, the production default) with the `sampintel-api`
context. Every request has an `x-correlation-id`, which the audit log stores too; search by it to follow one action
through the API, the audit log and the scheduler. Logs never contain secrets, tokens, respondent refs or answers.

## QA worker

Each pass, per active tenant, the worker takes up to 5 due synthetic QA jobs (locked with `SKIP LOCKED`, so several
instances can run it), runs their sessions against the FIXTURE sandbox survey (the only survey driver built), and records
validation, quality and model usage. Budgets in `/budgets` stop a job when spend would pass the limit.
`QA_TICK_SECONDS=0` turns the in-process worker off.

## Scaling

The API is stateless (sessions are rows in Postgres), so add instances behind the load balancer. The measured
single-box numbers are in [../production/performance.md](../production/performance.md). Postgres is the limit first:
watch connection count and slow queries before adding API instances.

## Routine

- Daily: check the alerts above are quiet and the nightly backup exists with its `.sha256`.
- Weekly: `pnpm audit` on `main` (CI also fails pull requests on moderate or worse advisories).
- Quarterly: restore drill ([backup-restore.md](backup-restore.md)) and review of tenant admins and service tokens.
