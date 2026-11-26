# Production readiness checklist

Status on 2026-11-26 (Phase 8). "Done" means built and checked in this repository; "Needs owner" means it depends on
infrastructure or a decision outside the code. **Production has not been deployed.** That needs Kunal's approval
through [../runbooks/deployment.md](../runbooks/deployment.md).

| Area | Item | Status |
|---|---|---|
| Configuration | API refuses to start in production with unsafe settings (insecure cookie, http origin, example values, owner DB role, load-test rate limits) | Done |
| Health | `/health/live` and `/health/ready` (503 when the database is unreachable); compose healthcheck uses readiness | Done |
| Observability | Prometheus metrics behind a bearer token, route-pattern labels; QA worker run, duration and last-success metrics | Done |
| Observability | JSON logs in production with correlation ids | Done |
| Observability | Alert rules and dashboards | Needs owner (thresholds in operations.md) |
| Security | Nonce-based CSP, HSTS over https, frame denial on the web app; strict CSP on the API | Done |
| Security | Row-level security on every tenant table; app role separate from owner | Done |
| Security | Dependency audit clean; CI fails on moderate or worse | Done |
| Security | Field encryption key rotation, drilled | Done |
| Security | External penetration test | Needs owner |
| Safety | Synthetic QA only under a project authorization; kill switch; budgets; SYNTHETIC labels on every export; no proxy, antidetect, CAPTCHA or IP rotation features | Done |
| Data | Backup and restore scripts, restore drill passed | Done |
| Data | Nightly schedule, off-host storage, point-in-time recovery | Needs owner |
| Release | Tag-only image build with SBOM and provenance; no automatic deploy | Done |
| Performance | Load checks every phase; numbers in performance.md | Done |
| Accessibility | axe (WCAG 2.0 A/AA, 2.2 AA) on 17 page states in the browser checks | Done |
| Accessibility | Manual screen reader and contrast pass | Needs owner |
| Integrations | Live survey drivers | Not built: only the FIXTURE sandbox survey exists |
| Integrations | Live model providers | Built: any AI can be added from AI API Management (Claude, OpenAI, Gemini, any OpenAI-compatible API). Before production, add a real key, run Test, and set budgets |
