# Incidents

## Severity

| Sev | Example | Response |
|---|---|---|
| 1 | Synthetic runs against a survey no authorization covers, synthetic data labelled as human, data visible across tenants, production down | Act now, page the owner |
| 2 | QA worker failing, budget stops misfiring, Supply360 link refusing service tokens | Same working day |
| 3 | One page broken, slow reports | Next planned release |

## First five minutes

1. **Stop harm before diagnosing.** Use the kill switch on `/executions` (with a reason). It is recorded in the audit
   log, no synthetic session starts until it is turned off, and nothing is deleted. For one project, pause it on its page.
2. Note the time, the tenant and a correlation id from the failing request or the audit log.
3. Check `/api/v1/health`, the 5xx rate and `si_scheduler_last_success_timestamp_seconds`.

## Common cases

- **Database unreachable:** `/health/ready` answers 503 and the load balancer drains the instance. The API recovers
  by itself when the database answers again.
- **Run against an unauthorized target:** Sev 1. Kill switch, revoke the project authorization, keep the execution
  events and audit trail, and tell the survey owner.
- **Model provider failing or over budget:** jobs stop with the reason recorded; check `/budgets` and the provider
  configuration. Never raise a budget to get a run through without the budget owner.
- **Supply360 link failing:** the `sik.` service token may be expired or revoked. Issue a new one under
  integration tokens and save it in Supply360's SampIntel connection.
- **Suspected cross-tenant exposure:** Sev 1. Kill switch, keep logs, do not delete rows, and check `DATABASE_URL` is
  the `si_api` login role (row-level security applies to `si_app`).
- **Secret leaked:** rotate it now ([key-rotation.md](key-rotation.md)).

## Afterwards

Write a short review within five working days: timeline, impact (tenants, projects, sessions), cause, what stopped
it and the follow-up changes. Keep it free of survey content that the authorization withholds.
