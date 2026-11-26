# SampIntel AI runbooks

| Runbook | Use it when |
|---|---|
| [deployment.md](deployment.md) | Shipping a release to staging or production (needs an approved change) |
| [operations.md](operations.md) | Day-to-day checks: health, metrics, scheduler, logs, scaling |
| [incidents.md](incidents.md) | Something is wrong: triage, kill switches, communication |
| [key-rotation.md](key-rotation.md) | Rotating the field encryption key, session secret, metrics token or integration secrets |
| [backup-restore.md](backup-restore.md) | Taking backups, restoring, and the quarterly restore drill |

Ground rules that hold in every runbook:

- **Nothing reaches production without a named approver.** CI never deploys; the release workflow only builds images.
- **Synthetic QA only, and only with an authorization.** SampIntel runs synthetic sessions against surveys a project
  authorization covers. It never impersonates real respondents, rotates IPs, uses proxies or antidetect browsers,
  bypasses CAPTCHA or produces human completes, and synthetic outcomes never count as human data anywhere.
- Every export is labelled SYNTHETIC. If a fix seems to need any of the above, stop and escalate.
- Never paste secrets into tickets, chat or logs. Every script here prints counts, not values.
