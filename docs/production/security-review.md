# Security review (Phase 8)

Scope: the SampIntel AI API and web app. Method: review of each control, automated tests and the browser checks.
An external penetration test should follow before go-live.

| Threat | Control | Checked by |
|---|---|---|
| Cross-tenant access | Postgres row-level security for every tenant table; requests as the `si_app` member role; production refuses an owner role | Integration tests; config tests |
| Session theft, CSRF | httpOnly, SameSite=Strict, Secure cookies; server-side revocable sessions; `x-si-csrf` header required on writes | Platform tests |
| Credential stuffing | Sign-in throttle (production cap 30/min), lockout, mandatory TOTP MFA | Platform tests |
| XSS, clickjacking | React escaping; nonce CSP with `strict-dynamic`; `frame-ancestors 'none'`; API `default-src 'none'` | e2e CSP checks |
| Misuse as a fraud tool | Synthetic runs need a project authorization; only the FIXTURE sandbox driver exists; no proxy, antidetect, IP rotation or CAPTCHA features; synthetic outcomes are labelled and never reported as human | QA tests; code review |
| Survey content leakage | Question wording withheld from exports unless the authorization allows it; export history records who exported what | Export tests |
| Spreadsheet formula injection | Cells that a spreadsheet would run as a formula are neutralised | Export tests |
| Runaway model spend | Per-tenant budgets stop jobs before the limit; usage recorded per call | QA tests |
| Secrets at rest | AES-256-GCM with per-value context; previous-key fallback and re-seal; service tokens stored as hashes | Sealer tests; rotation drill |
| Vulnerable dependencies | Exact pins; `pnpm audit` clean; CI audit job | CI |

## Fixed in this phase

1. `uuid` below 11.1.1 through ExcelJS (moderate): overridden to 11.1.1.
2. `esbuild` 0.24 or older through drizzle-kit (moderate, development only): overridden to 0.28.2.
3. No Content-Security-Policy on the web app: added a per-request nonce policy.
4. Production only checked `COOKIE_SECURE`: now checks origin, example values, DB role and rate limits too.
5. No field key rotation: added.

## Open items

External penetration test; secret manager integration; `style-src 'unsafe-inline'` remains for the UI library's
inline styles (scripts are nonce-bound).
