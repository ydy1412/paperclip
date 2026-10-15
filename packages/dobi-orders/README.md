# Dovix Dobi Orders domain

Ported from the user-owned `ydy1412/dobi-orders` repository at `d8aaccb268ad730b7dbf9d4cec4d84a375184797` (v0.3.0). The source repository remains separate.

This domain owns order normalization, local work/claims, tracking, files, connectors, forwarding drafts and result reconciliation. It does not call the legacy Auto Sourcing order or shipping paths. The Dovix host owns board authorization, project ownership, encrypted secrets, and audit events. The frontend mounts within a scoped DOM root, without iframe, eval or global DobiUI state, and preserves the imported interaction logic.

Each company/project has its own SQLite database below the instance `dobi-orders` directory. Catalog, carriers and channels are seed data in `reference_data`, read afresh on requests. Update through the authenticated `reference` API or the scope database; no source edit is required. Per-user form drafts are stored in the same private database; credential forms are excluded. Businesses and account mappings are domain metadata. No old order or credential data is imported automatically.

## Host API
`/api/companies/:companyId/sourcing/projects/:projectId/order-management` hosts the original relative API operations. Mutations require the Dovix board session and its CSRF policy. Browser-helper routes only accept paired capabilities; codes are one-use, capabilities expire after 24 hours, and each operation rechecks the granting user's active membership. The downloaded extension is configured for the current host URL and this scope.

Official Coupang/SmartStore/Cafe24 reads, ESM session reads and configured recipe operations are imported implementations. The provider catalog is not a claim that all listed companies support live API actions. Windows DPAPI remains only for standalone original regression compatibility; the Dovix host always supplies its existing encrypted vault adapter.

## Verification
`pnpm --filter @paperclipai/dobi-orders test` runs 72 cases: the original 69 and three hosted-domain cases (the Windows DPAPI case is skipped on macOS). `pnpm exec vitest run server/src/__tests__/dobi-orders.test.ts` checks real PostgreSQL authorization/secret metadata and persistent SQLite scopes. `node --import ./server/node_modules/tsx/dist/loader.mjs server/scripts/dobi-orders-browser-fixture.ts` starts an explicit loopback-only synthetic browser fixture on port 4331. It must not use operating data or be exposed to the network. To verify the compiled UI, first run `pnpm --filter @paperclipai/ui exec vite build --config vite.dobi-browser.config.ts`, then set `DOBI_BROWSER_BUILD=1` when starting the fixture. `DOBI_BROWSER_STATE_DIR` can retain only a prior synthetic fixture directory.

No domain data, decrypted secrets, real customer records or browser evidence belongs in Git.
