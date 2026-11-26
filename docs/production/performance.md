# Performance report

Measured with `pnpm --filter @si/api load-test` on one 4-core sandbox, with the API and Postgres 18 on the same
machine, the per-address rate limits raised for the run and the QA worker off. Baseline for comparing phases, not a
capacity promise. No number here is estimated.

## Phase 8 run (2026-11-26, metrics middleware and production hardening on)

Sign-in with MFA, 19 at once: p50 953 ms, p95 1,095 ms (Argon2id hashing is deliberately slow).

| Users | req/s | Requests | Errors | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|---|---|
| 10 | 675 | 10,134 | 0 | 13.9 | 24.4 | 32.5 |
| 50 | 718 | 10,815 | 0 | 67.3 | 104.6 | 146.1 |
| 100 | 737 | 11,112 | 0 | 137.7 | 189.8 | 207.1 |

## Trend (req/s, 0 errors in every run)

| Phase | req/s |
|---|---|
| 1 | about 790 |
| 6 | 648 to 748 |
| 7 | 687 to 809 |
| 8 | 675 to 737 |

The API is stateless; with more load, move Postgres to its own hardware and add API instances. Re-measure on
production-sized hardware in staging before setting service levels.
