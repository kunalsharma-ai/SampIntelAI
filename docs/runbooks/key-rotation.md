# Key rotation

Rotate on schedule (yearly), when someone with access leaves, or at once when a value may have leaked.

## Field encryption key (`FIELD_ENCRYPTION_KEY`)

It seals TOTP secrets and model provider API keys (AES-256-GCM with a per-value context). The API opens values with the current key and then
`FIELD_ENCRYPTION_KEY_PREVIOUS`, so rotation needs no downtime:

1. Generate a key: `openssl rand -base64 32`. Store it in the secret manager.
2. Deploy with `FIELD_ENCRYPTION_KEY=<new>` and `FIELD_ENCRYPTION_KEY_PREVIOUS=<old>`. New values seal with the new key;
   old values still open.
3. Re-seal every stored value, as the owner role:
   `DATABASE_ADMIN_URL=... FIELD_ENCRYPTION_KEY=<new> FIELD_ENCRYPTION_KEY_PREVIOUS=<old> pnpm --filter @si/api rotate:reseal`.
   It runs in one transaction, prints counts per column, and is safe to run twice. If any value opens with neither key
   it stops and changes nothing.
4. Deploy without `FIELD_ENCRYPTION_KEY_PREVIOUS`. Destroy the old key once backups sealed with it have aged out.

Drill (2026-11-26, restored copy of the local database): 21 TOTP secrets re-sealed (no provider keys are stored
locally, since only the FIXTURE provider is configured); a second run re-sealed 0; every value then opened with the
new key alone.

## Session secret (`SESSION_SECRET`)

Changing it signs everyone out. Rotate it outside running QA windows.

## Metrics token (`METRICS_TOKEN`)

Update the Prometheus scrape config and the API together; there is no overlap window, so expect one missed scrape.

## Integration secrets

- **Supply360 service tokens (`sik.`):** issue a new token under integration tokens (shown once), save it in
  Supply360, then revoke the old one. Tokens are stored as hashes, so they need no re-seal.
- **Model provider keys:** save the new key in the provider configuration (sealed at once), then revoke the old key
  with the provider. Each connection added on AI API Management (Claude, Groq, OpenRouter and so on) has its own sealed key.
