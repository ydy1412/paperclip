# Auto Sourcing native connector

The host requires `autoSourcing.request`, `autoSourcing.sync` and
`autoSourcing.shipping` RPC support (shipping introduced in 0.2.0, preparation in 0.3.0,
carrier catalog reads in 0.4.0).
Configure a company-owned serviceToken secret reference and a projects object
mapping active Paperclip project IDs to existing Auto Sourcing account IDs.
The service runs on 127.0.0.1:3115; credentials never reach this worker.

UI data keys: accounts, orders, detail, sync-state, carriers. The sync-orders action is a
human-only read from Coupang, not an order mutation. Agent tools only read stored
data and configured accounts. Version 0.5.0 also exposes scoped source-processing and common catalog local editing, described below.

`shipping-order` is an authenticated board-only action requiring
`auto-sourcing.shipping.write`. Operations: preview, dispatch (with the returned
15-minute confirmation), and status. Only normal full shipments of Preparing
orders are supported. Per-order courier/invoice inputs bind to fresh provider
snapshots through Auto Sourcing's durable operation tickets. Results are
independent for each selected order; Sending/unknown/pending/partial outcomes
must be checked and never automatically replayed. No shipping agent tool exists.

Version 0.3.0 adds prepare-preview, prepare (with confirmation) and prepare-status
to the same operator shipping-workflow capability. These act on eligible Paid
orders through the existing orders/Prepare tickets, acknowledgement PATCH and
fresh Preparing readback. No courier/invoice parameters are allowed for this
step. The New tab supports page-scoped bulk preparation, then navigation to
상품준비중; that list exposes 운송장 등록·발송 with the existing courier radios
and individual tracking-number inputs. Agent tools remain stored reads only.

## Carrier reference data

The `carriers` native data handler reads current enabled carrier rules for a
bound sales account. Auto Sourcing SQLite `shipping_carriers` is the only owner
of codes, display names, invoice lengths/formats and provider-name aliases.
The operator invoice dialog refreshes this local catalog every five idle seconds
and on focus, with an explicit refresh button; interval polling pauses during
batch actions. There is no static fallback;
failed catalog reads block new shipping requests. Existing agent tools and
shipping authority remain unchanged.

## Local processing drafts (0.5.0)

`autoSourcing.processingRead` (`auto-sourcing.products.read`) and
`autoSourcing.processingWrite` (`auto-sourcing.drafts.write`) add six tools:
get-processing-source, list-processing-drafts, get-processing-draft,
validate-processing-draft, create-processing-draft and save-processing-draft.
They require the current project/account. Source access also requires explicit
`sourceProducts: { "<project UUID>": ["taobao:<product ID>"] }` configuration.
An absent allowlist grants no source access. The worker never resolves credentials.
The host retains run/company/project checks and the .NET service persists draft
ownership, original SKU links and expected revisions. Old CLI drafts are not
implicitly adopted by a project. No marketplace write is exposed.

Board data key `processing` supports source/list/get/validate; board action
`processing-draft` supports create/save. Unknown fields are rejected. The host
transport timeout remains bounded; after an uncertain save, read the draft before
retrying. Source file hashes and source SKU fields are checked on every operation.
Category metadata is unverified in this increment; crop dimensions are declared
plans with pending status, never derivative images or proof of source dimensions.

Deploy prerequisites: back up/migrate Auto Sourcing using the additive
ProcessingDraftScope migration, deploy the compatible host/shared/SDK/worker/UI
set, grant the two capabilities and bind the project source allowlist. The 2026-10-09 catalog rollout applied the compatible contracts and migration. Source products still require an explicit project allowlist; builds alone do not establish real source/merchant success.

## Business/store and common catalog (0.5.0)

The native host also requires `autoSourcing.catalogRead` and `autoSourcing.catalogWrite`, using the products.read and drafts.write capabilities. Four tools list/get common products, list safe stores and save local product fields. They retain current-run/company/project checks. Agent store views mask legal registration numbers and omit legacy adoption choices; credentials and publication queue/import operations are operator-only.

The board UI calls `/api/companies/:companyId/sourcing/projects/:projectId/catalog` through the native host, not the worker, for business/store registration and encrypted credentials. Provider form metadata comes from AutoSourcing SQLite; stored secret values are never returned. New accounts are merged atomically into this plugin config project allowlist, preserving other config.

Coupang list/detail imports populate one shared master with per-store registrations. Reimport refreshes snapshots without overwriting master edits. Sourcing/Uploads share one editor and durable revision checks. The operator queue freezes selected targets/intent/data/revision; confirmed existing listings use PUT, missing listings POST with an approved target shipping template, then GET verification. Uncertain responses block replay and permit GET-only reconciliation. Agents do not have a live publish tool. Additional providers remain registration-only.

Validation/operating and remaining merchant/crop/category limits are in sibling `auto-sourcing/specs/005-product-publishing/catalog-result.md` and `doc/plans/2026-10-07-auto-sourcing.md`.
