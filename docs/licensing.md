# Licensing

> **Status:** stub — populated with Phase 8.

## Model

- **Storefront / merchant of record:** LemonSqueezy. Handles VAT /
  sales tax globally and issues receipts.
- **Key management:** Keygen.sh. Issues Ed25519-signed activation tokens
  that the app verifies offline.
- **Webhook:** LemonSqueezy → a small backend function → Keygen
  `create-license` → email the key to the customer.

## Trial

- 14 days, starts on first launch (tracked by `startedAt` + monotonic
  `lastSeenAt` in `app.getPath('userData')/license.json`).
- Clock-rewind beyond 6h tolerance → trial treated as expired.

## Activation

- User enters key → main calls Keygen → receives signed token → stored
  encrypted via Electron `safeStorage`.
- Offline verification of token signature on every launch.
- Online re-check every 7 days (and on demand).

## Enforcement

- Expired / invalid / revoked → read-only mode: viewing allowed,
  `fs.copy` / `fs.write` denied at the main boundary.

## Contact

- Purchase questions: sales@awapi.com
- Key / activation issues: support@awapi.com
