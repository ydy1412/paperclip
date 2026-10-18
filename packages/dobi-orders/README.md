# Dovix Dobi Orders domain

Ported from the user-owned `ydy1412/dobi-orders` repository at `7fc611f912e1033104ffcfcd8b922822d92ff51b` (v0.5.0). The source repository remains separate.

This domain owns order normalization, local work/claims, tracking, files, connectors, forwarding drafts and result reconciliation. It does not call the legacy Auto Sourcing order or shipping paths. The Dovix host owns board authorization, project ownership, encrypted secrets, and audit events. The frontend mounts within a scoped DOM root, without iframe, eval or global DobiUI state, and preserves the imported interaction logic.

Each company/project has its own SQLite database below the instance `dobi-orders` directory. Catalog, carriers and channels are seed data in `reference_data`, read afresh on requests. Update through the authenticated `reference` API or the scope database; no source edit is required. Per-user form drafts are stored in the same private database; credential forms are excluded. Businesses and account mappings are domain metadata. No old order or credential data is imported automatically.

## Host API
`/api/companies/:companyId/sourcing/projects/:projectId/order-management` hosts the original relative API operations. Mutations require the Dovix board session and its CSRF policy. Browser-helper routes only accept paired capabilities; codes are one-use, capabilities expire after 24 hours, and each operation rechecks the granting user's active membership. The downloaded extension is configured for the current host URL and this scope.

Marketplace reads in Dovix use the imported Wing/seller session clients. Existing official/custom-key accounts for session-capable markets require login reconnection under the same connection ID; key collection is blocked. Kakao API remains explicitly key-only. ESM session reads and forwarder recipe operations remain available. The provider catalog is not a claim that all listed companies support live API actions. Windows DPAPI remains only for standalone original regression compatibility; the Dovix host always supplies its existing encrypted vault adapter.

## Verification
`pnpm --filter @paperclipai/dobi-orders test` runs the imported domain regressions and hosted session/compatibility cases. Windows-only native tests are skipped on macOS. Synthetic native adapter tests do not enable native login in Dovix. `pnpm exec vitest run server/src/__tests__/dobi-orders.test.ts` checks real PostgreSQL authorization/secret metadata and persistent SQLite scopes. `node --import ./server/node_modules/tsx/dist/loader.mjs server/scripts/dobi-orders-browser-fixture.ts` starts an explicit loopback-only synthetic browser fixture on port 4331. It must not use operating data or be exposed to the network. To verify the compiled UI, first run `pnpm --filter @paperclipai/ui exec vite build --config vite.dobi-browser.config.ts`, then set `DOBI_BROWSER_BUILD=1` when starting the fixture. `DOBI_BROWSER_STATE_DIR` can retain only a prior synthetic fixture directory.

No domain data, decrypted secrets, real customer records or browser evidence belongs in Git.

## Session login

New connections default to Wing ID/password or seller login. Wing supports the original SMS/email challenge and first vendor confirmation. Seller clients retain their original store verification, cookie/token persistence, one re-login on expiry and atomic complete collection. Credentials stay in the Dovix encrypted vault; no automatic key fallback occurs. Existing account/business/order references remain in place when login is reconnected.

Use GET/POST `connections/:id/wing-login` and `connections/:id/seller-login` for status and supported start/challenge/confirm/cancel steps. The hosted API rejects `native`; Windows WebView2 windows and a new Chrome session bridge are outside this phase. Browser-only authentication requests show an explicit limitation. The original key-only Kakao API type is not advertised as session support.

Operator provider names/URLs and custom entries remain in SQLite; executable login capabilities refresh from the imported clients. Backups preserve seller binding and workspace data while excluding passwords, cookies, tokens and credential references. Restores require re-authentication. Live marketplace success is not established by synthetic HTTP or UI tests. Upstream behavior/limits: [seller login](docs/SELLER-LOGIN.md), [Wing](docs/COUPANG-WING.md). Windows-only instructions in imported upstream documents describe the original application, not hosted Dovix capabilities.
