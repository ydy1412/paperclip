# Shopping mall management navigation and layout

The latest integration and remaining work are recorded in the Native plugin and
orders integration section and Settings-style workspace layout (2026-10-08). Earlier sections are
dated navigation history or superseded proposals, not completed data workflows.

## Initial navigation scope (2026-10-07)

The operator approved adding the menu first and discussing the layout
before implementing product workflows. The later naming decision on 2026-10-07
replaces `소싱` with `쇼핑몰 관리`, because the workspace will cover sourcing,
product uploads, and orders. This change adds a `쇼핑몰 관리` link directly
after Marketing in both Work sidebar variants, a company-scoped `/sourcing`
route, and an intentionally empty page with a `쇼핑몰 관리` heading/breadcrumb.
Keep the existing `/sourcing` URL and internal component/file names for navigation
compatibility; this display-name change does not rename the Auto Sourcing project.
Unprefixed navigation uses the existing company redirect. No source products,
credentials, queues, agents, provider accounts, or database schemas are changed.

Canonical Auto Sourcing repository: `/Users/ydy1412/projects/auto-sourcing`.
Its existing .NET application remains the owner of source products, publishing
drafts, SQLite persistence, and collection jobs. Future tools should use the
existing Paperclip native plugin gateway; do not replace its business logic or
create a second authoritative collection queue in Paperclip.

## Native plugin and orders integration (approved 2026-10-08)

The operator now authorizes starting Auto Sourcing as a background service and
connecting real Coupang orders. The prior UI-only boundary is superseded only
for this integration; sourcing and product upload actions remain unimplemented.
Canonical service spec: Auto Sourcing `specs/006-paperclip-orders/`.

Use a native `paperclipai.plugin-auto-sourcing` plugin. UI data/actions and agent
read tools call a purpose-specific `autoSourcing.request` host capability. The
host enforces opaque company/run scope, active same-company project and configured
account binding, then resolves a company secret and calls fixed loopback routes.
Agent reads require an active assigned task/conversation in that exact project;
an unscoped agent task cannot read every configured sales account.
Do not weaken generic HTTP SSRF restrictions or give a worker the API token.
The plugin config binds project IDs to allowed existing Auto Sourcing accounts;
no shared-database inference or unrelated project binding. Initial operating
setup creates a dedicated Auto Sourcing project if none exists.

The Orders workspace uses native plugin data, account/status/search controls,
20-row pagination, list-to-detail navigation, explicit sync with progress and
dated observation metadata. Show only safe existing order fields. Sync reads
Coupang and updates its owning SQLite; no remote marketplace mutation. Opening
the page reads local data only. Preserve cached orders on errors, clear them on
company/project/account changes, and distinguish an empty list from not synced.

Validation and operating evidence are recorded here after implementation. Back
up operating code/UI and databases before compatible installation; preserve
Knowledge, Artifacts, Marketing and existing draft/publication records. Restart
Paperclip only if a host bridge update requires it and active work is idle.

### Orders implementation evidence (2026-10-08)

- [x] Implement the loopback .NET API/background worker in Auto Sourcing without
  duplicating its order database in Paperclip.
- [x] Read actual Coupang orders safely: 47 stored, including 22 shipping and
  25 delivered. Shipping groups Shipped and InTransit; Paid/Preparing were empty.
  No marketplace writes or customer identity fields were added.
- [x] Implement the native plugin's three read tools, native host capability,
  configured company/project/account boundary and operator-only sync action.
- [x] Implement search/status/pagination/detail, explicit 31-day sync,
  queued/running/error display and cached-row preservation.
- [x] Prepare a five-file host candidate verified against the installed older
  runtime, and a compatible UI candidate preserving existing feature modules.
- [x] Run source tests/type checks/builds and refresh the scoped structural graph.
- [x] Apply the operating host, install/configure the plugin and bind its dedicated
  Auto Sourcing company project after the operator's restart approval (2026-10-08).
- [x] Verify the actual orders screen and list/detail/filter/reload through Aside.
- [ ] Verify a real mobile viewport and actual agent use of the registered tools.

Evidence: `server/src/services/auto-sourcing-plugin.ts`,
`packages/plugins/plugin-auto-sourcing/`, `ui/src/api/sourcing.ts`,
`ui/src/components/SourcingOrders.tsx`, Auto Sourcing `specs/006-paperclip-orders/`.
Host tests passed 4 cases with actual isolated PostgreSQL;
`server/src/__tests__/marketing-plugin.test.ts` passed 8;
SDK host-client/worker-rpc tests passed 40; native plugin tests passed 3.
Broader UI: 8 files / 187 tests including SourcingOrders, Sourcing, Layout,
Sidebar, company-routes, Marketing, Knowledge and Settings. Server/UI/plugin
type checks, shared/SDK/plugin/UI builds and token gates passed. Commands use
`pnpm exec vitest run` with explicit paths, `pnpm exec tsc --noEmit` for
server/plugin, `pnpm --dir ui typecheck|build`, `pnpm check:token-gates`,
and `git diff --check`.

The existing scoped code-only Graphify output was refreshed with 60 explicit
files: 644 nodes / 1032 edges. Known dangling references and collapsed edges
remain diagnostic limitations, not complete dependency/runtime evidence.
Focused Hindsight recall informed native scope preservation; the approved
orders-only boundary and verified host behavior were selectively stored in the
repository-specific bank and read back with matching provenance. No customer
data, credentials or complete conversations were stored.

Auto Sourcing runs at `http://127.0.0.1:3115`; authenticated readiness and
unauthenticated HTTP 401 were verified. Stored orders survive restart, while
process-local sync progress honestly returns unknown. Credentials remain in
private runtime files; the host will resolve a reference from Paperclip's
existing company secret store, never send tokens to workers/browsers.

Operational helpers: `tmp/sourcing-dev/orders-update.mjs --prepare|--apply|--connect`
and `navigation-update.mjs --prepare|--apply|--verify`. Orders integration has
been applied and verified. Both guard operating hashes; apply backs up database/host/UI
and checks active work is idle. Repeated UI prepare initially rejected the
unapplied candidate because only its new hash was allowed; it now also permits
its recorded unchanged previous operating hash. Unknown operating changes
still cause rejection.

Rollback preparation: restore only backed-up host files/UI entry after disabling
the new plugin, with an approved idle restart. Preserve project/configuration
and order records; do not overwrite newer data with an old dump. Actual rollback
execution is unverified. Detail shows stored product/option IDs because the
existing model lacks product names/photos; do not invent them. Sourcing/upload
integration remains outside this change.

### Operating verification after approval (2026-10-08)

- Backed up PostgreSQL and the five affected host files before the approved
  idle restart. The compatible files match the candidate hashes. A transient
  ECONNRESET occurred during the first post-restart health read; service status,
  installed hashes and fresh HTTP baseline checks confirmed the restart succeeded.
  `--connect` resumed only plugin/configuration setup after checking applied
  hashes, rather than copying files or restarting again. Original Marketing
  publication records remained unchanged.
- Installed `paperclipai.plugin-auto-sourcing` as a ready native plugin, created
  the dedicated Auto Sourcing company project, and bound the existing enabled
  Coupang account through a company-owned encrypted secret reference. Native
  bridge list/detail/search succeeded; unbound project access was rejected.
  Three read tools are visible in the global native tool registry. Actual agent
  invocation is not claimed. No service or marketplace token was printed.
- Backed up the operating UI and switched the HTML entry to its compatible
  candidate. Health, existing Hindsight/Marketing plugins, Marketing, Artifacts
  and artifact folders remain available. Orders/Marketing/Knowledge/Artifacts
  route and asset-entry checks passed after application.
- Native stored data initially returned 47 orders and pages 20/20/7. Aside u1
  then clicked the actual sync button: queued/running/completed was verified,
  repeated submission was disabled, and existing rows remained displayed.
  Read-only Coupang refresh completed at 14:45 KST: 49 orders, 21 Shipping,
  26 Delivered, 2 Paid, 0 Preparing. These dated counts supersede only the older
  snapshot, not order state definitions; no marketplace writes were performed.
- Aside u1 verified the Orders menu, actual project/account selection, Shipping
  filter, 20 rows on page one / 1 on page two, order-number search returning one
  row, item detail, and detail/filter restoration after reload. No alert was
  present; viewport 1485x870 and document width 1485 showed no outer overflow.
  Query-completion waits were needed before clicking pagination during refetch.
  The CLI's label selector was unsupported for selectOption, so the same
  inspected aria-label was used as a CSS locator. No browser fallback was used.
- Screenshot inspected:
  `/Users/ydy1412/.aside/u/1/sessions/2026-10-08_0kzfMk6I00iYiOYD/artifacts/coupang-orders.png`.
  Host/database and UI backup receipts are under `tmp/sourcing-dev/production-backup/`
  and the existing candidate directories. Operating smoke rechecks passed.

Remaining: real mobile viewport validation, actual assigned-agent tool invocation,
product name/photo enrichment, and separately scoped sourcing/upload workflows.

### Whole-row order detail selection (2026-10-08)

Clicking any order row now opens the stored detail while preserving project,
account, status, search and pagination. The native order-number button remains
keyboard accessible; its click bubbles to the row without a second handler.
Focused SourcingOrders/Sourcing tests passed 20 cases, including six row/cell/button
selection cases. UI type check, compatible UI build, token gates and diff checks
passed. The existing 60-file structural graph was refreshed without widening scope.
The UI was backed up and applied without server or database changes; baseline
APIs and route/asset checks passed. Aside u1 verified status/amount clicks, Enter
selection, close, context preservation and reload on the actual operating screen.
There were no alerts or outer overflow at 1485px. Mobile and product enrichment
remain unverified/unimplemented as stated above.

## Sourcing and upload screen preview (approved 2026-10-08)

The operator requested the two remaining screens first, not remote collection
or marketplace publication. Retain Settings-style vertical navigation and the
existing project selector. Build explicitly labelled example-data workspaces;
do not claim the orders-only native bridge provides products or publication drafts.
No database, API capability, authoritative queue, source collection, model run,
or marketplace mutation is added in this UI-only change.

Requirements and design:
- Sourcing: compact source/status/search controls, checkbox product list, source
  cost/options/status, and a right detail panel with information/options/source tabs.
- Uploads: account/validation/search controls, checkbox draft list, proposed price,
  validation/registration state, and information/checks/registration-history tabs.
- Both: clearly show example-data provenance, allow switching to the truthful
  unconnected live-data empty state, filter/search/reset/select-all/detail/close,
  keyboard access, invalid-item and no-results states. Bulk selection must not
  open details. Remote mutation controls remain absent until a real contract exists.
- Preserve company/project scope and native Orders behavior. Changing workflows
  clears workflow-specific search/filter/item/page state, retaining project only.
- Use existing semantic tokens, restrained flat tables and shared UI primitives;
  desktop list/detail split, narrow-screen detail/back behavior, no decorative cards.
  The initial preview omitted images; the later example-image extension below
  supplies generated mockups, never fabricated supplier evidence.

Technical plan: extend Sourcing.tsx and SourcingSidebar.tsx, add one bounded
SourcingCatalogPreview component and static example records in the existing lib
directory; extend the existing compatible navigation UI helper to copy these files.
Keep mutable selection in component state scoped by company/project/workflow.
Store preview mode/filters/item in the existing URL for reload/back support.

Execution checklist:
- [x] Implement both preview workspaces, interactive lists and detail tabs.
- [x] Verify filters, selection, detail/reload, context isolation and no native writes.
- [x] Pass focused regression tests, UI type check/build and design token gates.
- [x] Back up and apply compatible UI only; verify actual operating screens via Aside.
- [x] Reconcile this document and refresh the existing scoped structural graph.

Validation evidence (2026-10-08):
- `SourcingCatalogPreview.test.tsx`, `SourcingOrders.test.tsx`, and
  `Sourcing.test.tsx`: 37 cases passed after the final layout change.
  The broader nine-file UI regression set passed 210 cases, covering Layout,
  Sidebar, company-routes, Marketing, Knowledge and CompanySettingsSidebar.
  `pnpm --dir ui typecheck`, `pnpm --dir ui build`, compatible UI preparation,
  `pnpm check:token-gates`, and whitespace checks passed. Existing build warnings
  about CSS highlight selectors, config-loader compatibility and large chunks remain.
- Aside u1 verified the actual sourcing filters/search, independent checkbox
  selection, keyboard detail, options/source tabs and URL restoration; upload
  account/validation filters, checks/history tabs, unconnected live mode and
  selection reset; workflow switching also left stored native Orders available.
  The CLI role-name selector failed once; inspected CSS locators worked without
  changing browser/account. No collection, publication, model or order-sync action
  was triggered by these preview checks.
- The final compatible UI was backed up and applied without a server restart,
  database change or bridge capability change. Baseline APIs and route/asset
  entry checks passed. Desktop 1485x870 had no alerts or outer overflow.
  Status glyphs use existing mode-aware task-status tokens, confirmed by computed
  styles. Product titles fit; account brand and example-account labels are separate.
- Inspected screenshots:
  `/Users/ydy1412/.aside/u/1/sessions/2026-10-08_rTWS9rvxYnDDZKON/artifacts/sourcing-preview.png`
  and `uploads-preview.png` in the same artifact directory.
- The existing structural graph was refreshed with its original 60 sources plus
  the two new production UI sources: 62 files, 656 nodes / 1053 edges.
  Known dangling-reference and edge-collapse limitations still apply.
- Focused project Hindsight recall informed the orders-only bridge boundary.
  The verified preview-only implementation boundary was stored as
  `shopping-mall-catalog-preview-2026-10-08` in the repository-specific bank and
  read back with matching document/source metadata. Synthetic fixture values,
  credentials and complete conversations were not saved as knowledge.

Remaining: real source-product/publication-draft native integration, real product images
and source evidence, marketplace write validation, and actual mobile viewport QA.
Example input checks are not provider validation; blank registration history is
not proof of successful publication. Do not count these screens as backend completion.

### Example product images (requested 2026-10-08)

Add local generated bitmap product mockups to the existing example screens, not
images presented as collected Taobao/1688 evidence. Keep the existing operational
layout and token system. Images have a stable square frame, meaningful alt text,
an explicit generated-example provenance label, and a visible load-error state.
Use a bounded gallery for detail viewing, including a second cable-box view;
uploads allow choosing the representative image within that product's examples.
This selection is screen-preview state only: no persistence or marketplace write.
Company/project/workflow changes and reload restore fixture defaults. Image input
checks reflect the selected image but never claim provider validation.

Technical plan: extend `sourcing-preview.ts` and `SourcingCatalogPreview.tsx`,
place generated assets in `ui/public/sourcing-examples/`, and extend the existing
compatible UI helper to copy that bounded asset directory. Reuse shared buttons,
tabs and dialog; do not add another product store, API or native tool capability.
Inspect the registered native tools and project scope read-only to answer agent
readiness; do not run a paid agent or collect/register products for this question.

Execution checklist:
- [x] Add and inspect local product mockups with provenance.
- [x] Implement list thumbnails, detail gallery/enlargement and upload image choice.
- [x] Verify alt/error state, choice reset, native Orders and context isolation.
- [x] Pass focused tests, UI type/build and token checks; apply compatible UI safely.
- [x] Verify operating image requests and interactions via Aside, reconcile evidence.
- [x] Inspect actual agent-tool readiness separately from this example UI.

Verified results:
- Five 1254x1254 PNG mockups generated/inspected using the built-in image tool
  and copied to `ui/public/sourcing-examples/`: `cable-box.png`,
  `cable-box-open.png`, `cup-holder.png`, `desk-organizer.png`,
  `travel-pouches.png`. No supplier photos or image-option mapping is claimed.
- Prompt set: unbranded white vented cable-management box, black silicone cup
  holder, mint desktop organizer, gray travel-pouch trio; each is a square,
  centered photorealistic product mockup on a light neutral studio background,
  no text/logo/UI/collage. The second cable-box image is a reference edit opening
  the same box and resting the lid behind it. All prompts explicitly identify
  the image as an example, not real supplier evidence. Originals remain intact.
- Added six behavior cases to `SourcingCatalogPreview.test.tsx`: local images/alt
  in both lists, gallery/keyboard enlargement, representative choice/clear and
  input checks, failed assets, independent choices/context reset. The old UI
  failed all six before implementation. The final nine-file UI set passed
  216 cases; UI typecheck/build, compatible UI build, token gates and whitespace
  checks passed. Existing build warnings remain, not new image failures.
- The compatible UI was backed up and applied without server/DB/bridge changes.
  Asset signatures, dimensions and candidate hashes matched. Aside u1 confirmed
  all five images loaded, keyboard enlargement/close, representative selection
  changing the list thumbnail, selection clearing lowering example input checks,
  URL reload retaining the item but restoring its default image. Both screens
  had no alerts/outer overflow at 1485x870; native Orders still had 20 first-page
  rows without requesting remote sync. Real mobile remains unverified.
- Inspected screenshots:
  `/Users/ydy1412/.aside/u/1/sessions/2026-10-08_EbnfiOJSAiIGWdfA/artifacts/sourcing-images.png`
  and `/Users/ydy1412/.aside/u/1/sessions/2026-10-08_XBpfSXtgplWW26Ei/artifacts/upload-images.png`.
- Existing 62-file structural graph refreshed: 660 nodes / 1062 edges, no paid
  semantic extraction or new scope. Project Hindsight recall confirmed the
  preview/native boundary before current source and operating registry checks.
- The verified example-image/native-tool boundary was retained as
  `shopping-mall-example-images-2026-10-08` in the project bank and read back
  with matching document/source metadata. No fixture values, secrets or full
  conversations were stored; the previous missing-example-image claim is
  superseded without weakening the real-data integration boundary.

Agent readiness: the operating Auto Sourcing plugin is ready and the unfiltered
native registry exposes only `list-order-accounts`, `list-orders`, `get-order`.
The plugin-ID-filtered registry returned an empty list, so readiness here relies
on its actual namespaced descriptors in the complete registry, not that filter.
Current manifest/worker and project MCP discovery match these three order reads.
No native tool reads source products, writes a processed product/publication
draft, or returns an agent result to these preview screens. Actual assigned-agent
tool invocation was not performed; registration is not agent end-to-end proof.

Remaining: connect source-product reads and evidence-preserving processed draft
writes to the existing plugin/project scope, then test an assigned agent through
real data and the screen. Example image selections are transient, and generated
images do not establish product facts, variant coverage or provider validation.

## Earlier proposed layout (superseded by the approved screens above)

Use the existing restrained Paperclip workspace styling. No hero, summary cards,
fake metrics, or permanently visible inactive commands. Proposed work area:

```text
+------------------+------------------------------+-----------------------+
| Project          | Sourcing / Product uploads / Orders                  |
|                  +------------------------------+-----------------------+
| Sales account    | Search and filters           | Selected item         |
| - Coupang        +------------------------------+-----------------------+
|                  | [ ] Product / cost / options | Images and source URL |
| Source           | [ ] Product / order / status | Options or order lines|
| - Taobao         | [ ] Product / order / status | Evidence / processing |
|                  |                              | Responsible agent     |
| Connection state | Contextual selection actions | Draft / job status    |
+------------------+------------------------------+-----------------------+
```

- Left: project selector, then separately labeled sales account and source.
  Account health and worker availability remain here, not among product actions.
  Taobao/Coupang are current implementation examples, not claims of live login.
- Center: default product list, compact search/filter controls, select-all and
  row checkboxes. Clicking a row opens detail without changing checkbox selection.
  Selection actions appear only when applicable. Do not offer actual registration
  before its approval and provider verification contract is implemented.
- Right: detail follows the active tab: sourced product images/options/evidence,
  upload draft preview/issues/results, or order lines/shipment/processing history.
  Customer data must remain limited to authorized users and operations.
  Agent attribution is proposed
  integration metadata; existing imports must not be attributed to a made-up agent.
- Tabs: `소싱`, `상품 업로드`, `주문`; each reuses its owning Auto Sourcing data.
  Sourcing includes the source-product list and collection progress; uploads
  include local drafts, validation issues, and marketplace registration outcomes;
  orders include order lists, status filters, shipping, and processing history.
  Product preparation and marketplace submission stay distinct from SNS content.
- Responsive: on narrow desktop, detail replaces the list with a back action;
  mobile uses sequential project/list/detail views, not three squeezed columns.
- States: distinguish not connected, empty, loading, error, authentication needed,
  and unknown outcome. No timeout-based account deletion or blind resubmission.
- Marketing handoff is a contextual action on a selected product, not a copy of
  the complete sourcing catalogue into Marketing drafts.

The detailed proposal below uses list-first navigation, since collected data is
the input for both publishing drafts and marketing content. It remains a proposal
pending the operator's approval; no workflow implementation is authorized here.

## Earlier horizontal layout proposal (superseded 2026-10-08)

Scope: layout planning only. Reuse the existing global Paperclip sidebar and
DESIGN.md tokens/components. The Shopping mall management work area has three
unframed regions: project/account context, item list, and selected-item detail.
Use compact rows and real product thumbnails, without dashboard summary cards,
placeholder metrics, redundant draft/save buttons, or fake connected states.

```text
Paperclip sidebar | Shopping mall management
                  +-------------------+---------------------------------------+
                  | Project selector  | Sourcing | Product uploads | Orders    |
                  |                   +-------------------+-------------------+
                  | Sales accounts    | Search / filters  | Selected item     |
                  | - Coupang account +-------------------+-------------------+
                  |                   | [ ] Product row   | Images / identity |
                  | Sources           | [ ] Product row   | Options / evidence|
                  | - Taobao          | [ ] Product row   | Issues / history  |
                  |                   |                   |                   |
                  | Connection state  | Selection actions | Contextual action |
                  | Worker state      | Pagination        |                   |
                  +-------------------+-------------------+-------------------+
```

Context region:
- Project comes first. Changing it changes the whole workspace and clears item
  selection; never infer company/project ownership from a shared SQLite path.
- Keep marketplace sales accounts separate from sourcing providers and their
  browser/worker context. A Taobao source is not a Coupang sales account.
- Show only configured accounts/providers. Display last check time and dated
  connection observations separately from worker/job progress. Unknown queries
  preserve previous observations; they do not delete accounts or show success.
- Keep connection checking beside the account, never in product detail. Existing
  provider checks run only when requested, not merely because the page opened.

Tab contents:
- Sourcing (initial tab): thumbnail/name, source, collected cost/currency, option
  count, capture time, and import/collection state. Detail contains source images,
  original URL, source values, options, and provenance. Missing fields stay
  visibly unknown; image URLs are references, not downloaded-file claims.
- Product uploads: draft title, sales account, proposed KRW price, validation
  state, and remote registration/readback state. Detail contains the listing
  preview, selected SKUs, missing required facts, and operation history. Current
  pricing excludes fees/shipping/margin; do not label it a profitable sale price.
- Orders: order reference, sales account, state, quantities, amount/currency, and
  observed time. Detail contains order lines, shipping, and processing history.
  Start read-only; no customer details beyond the authorized existing contract.
  An empty local list is distinct from an API error or an unsynchronized account.

Interaction and actions:
- Row click opens detail; row checkbox only changes selection. Clicking one must
  not trigger the other. Select-all is limited to the visible page, with a count.
- Search/filter/pagination live above/below the list. Preserve each tab's filters,
  selection, and open detail on background refresh within the same context.
- With no selected item, use the space for the list rather than a large blank
  detail panel. Open detail alongside the list only when space allows.
- Show one relevant selection action, such as prepare upload drafts from selected
  source products. Actual provider registration requires a separate exact-target
  preview/confirmation and verified support; no registration action in phase one.
- Preparing a draft is not uploading a product. Pending/unknown registration
  outcomes show history/reconciliation, not a blind retry button.
- Offer Marketing handoff only from a selected source product when its real tool
  integration exists. Do not display nonfunctional controls for future features.

Responsive and states:
- Wide desktop: context, list, and optional detail side by side. Narrow desktop:
  preserve readable list columns and open detail in a drawer with a back action.
- Mobile: compact project/account picker, tabs and list, then full-width detail.
  Preserve selection on return; never squeeze three columns into a phone viewport.
- Use existing semantic colors for states, always with text. Distinguish loading,
  empty, disconnected, unavailable, blocked, pending, unknown, and successful
  readback. A ready plugin or idle worker is not proof of a connected marketplace.
- First implementation should bind source list/detail to real existing data.
  Upload drafts and stored orders follow; new collection and live writes remain
  separate, explicitly authorized validation work.

Planning checks (not implementation completion):
- [x] Reuse the inspected source/runtime status and existing layout proposal.
- [x] Check the existing design principles and UI design guidance.
- [x] Specify the regions, tab contents, selection, states, and responsive flow.
- [x] Operator selected a Settings-style vertical navigation instead; see below.
- [ ] Implement real source-product list/detail and the authorized integration.
- [ ] Verify implemented desktop/mobile behavior using Aside and local tests.

## Settings-style workspace layout (2026-10-08)

The operator approved building the layout first and explicitly requested the
same adjacent secondary navigation as Settings. This supersedes the horizontal
workflow tabs and extra project/account rail above. Keep the global Paperclip
menu and use its existing secondary-sidebar host in both Layout variants.

```text
Global app menu | Shopping mall management | Sourcing workspace
                |                         | Project selector
                | Sourcing                | Source product columns
                | Product uploads         | Data not connected
                | Orders                  |
                |                         | (No invented products or totals)
```

Implementation scope:
- A single Shopping mall sidebar lists Sourcing, Product uploads, Orders in that
  order, using company-aware links and Settings-style sidebar spacing/surfaces.
- Keep `/sourcing` compatible; persist the active workflow in `?view=` and the
  selected project in `?project=`. Preserve project context when switching views.
- Page breadcrumb and heading follow the workflow. Read actual company projects
  using the existing project API, with loading, denied/error, and empty states.
  Selecting a project is UI context only, not a verified Auto Sourcing DB binding.
- Show each workflow's intended table columns and a truthful data-not-connected
  state. No invented account/project/product/order records, zero-total claims,
  thumbnails, working collector/publisher claims, or nonfunctional action buttons.
- Do not show an empty detail rail before a real item is selected. Source and
  order data, search/selection/detail actions, connection monitoring and native
  shopping-mall tools remain separate integration work.
- Mobile reuses the existing shell's secondary-nav drawer/back-to-app behavior.
  Reuse tokens/components; no new dependencies, server changes or migrations.

Execution checklist:
- [x] Inspect existing Settings sidebars, layout hosts, routes and UI tests.
- [x] Record approved vertical layout and distinguish UI context from DB binding.
- [x] Add regression tests for view switching, project context and layout hosting.
- [x] Implement vertical navigation and workflow-specific unconnected list views.
- [x] Run focused/broader tests, UI typecheck/build and token gates.
- [x] Back up and apply a compatible UI-only candidate; verify with Aside.
- [x] Reconcile evidence and remaining integration work.

Verified implementation:
- `ui/src/components/SourcingSidebar.tsx` owns the vertical navigation;
  `ui/src/lib/sourcing-views.ts` shares its view IDs/labels/table columns with
  `ui/src/pages/Sourcing.tsx`. Both `Layout.tsx` and `Layout.production.tsx`
  mount the sidebar through the established secondary-sidebar host.
- Only the existing company project GET is added to the page. The picker reads
  real projects; no shopping-mall data API, collector, provider writes, account
  registration, project-to-SQLite binding, search, or item actions were added.
- Red validation failed for the missing sidebar and both new layout-host cases.
  After implementation, focused page/layout tests passed; the final broader run
  passed seven files / 181 tests: `Sourcing.test.tsx`, `Layout.test.tsx`,
  `Sidebar.test.tsx`, `company-routes.test.ts`, `Marketing.test.tsx`,
  `Knowledge.test.tsx`, and `CompanySettingsSidebar.test.tsx` in their existing
  `ui/src/pages`, `ui/src/components`, and `ui/src/lib` locations.
- Commands: `pnpm exec vitest run` with those explicit paths;
  `pnpm --dir ui typecheck`, `pnpm --dir ui build`, `pnpm check:token-gates`,
  and scoped `git diff --check` passed. Existing Vite configuration, CSS highlight,
  localStorage test-environment, and bundle-size warnings remain unchanged.
- Extended the existing ignored `tmp/sourcing-dev/navigation-update.mjs` to port
  only the new sidebar/view/page and scoped Layout edits onto the compatible
  candidate. `--prepare` and `--apply` passed; the UI was backed up before the
  asset-entry switch. Baseline health/plugins/Marketing/Artifacts/folders and UI
  routes remained available. No server restart or database change occurred.
- Aside account u1 verified the vertical order, each view's main heading/columns,
  actual project selection, context preservation through uploads/orders, and
  orders/project restoration after reload. Returned to sourcing with no project
  selected afterwards. At viewport 1485, document width was 1485; the secondary
  sidebar occupied x=240, width=240, immediately beside the primary menu. Main
  content started at x=480; exactly one workflow link was marked current.
  Screenshot: `/Users/ydy1412/.aside/u/1/sessions/2026-10-08_gekF3FgZn8UqnkUd/artifacts/shopping-mall-settings-layout.png`.
- Mobile drawer-close behavior is covered by a component test only; no actual
  mobile viewport screenshot was captured in this change. Real mobile layout
  validation remains outstanding, not a completed operating-browser check.
- Reused/query-checked the scoped Graphify graph and refreshed its established
  output with 55 explicit source files, 616 nodes / 990 edges. Raw diagnostics
  still report dangling references and collapsed edges; this is scoped structural
  evidence, not complete dependency or runtime proof.

Remaining: native Auto Sourcing integration with explicit company/project
ownership, real source-product list/detail, upload drafts and stored orders,
actual responsive browser verification, and separately approved live operations.

## Implementation and validation

Affected files: `ui/src/App.tsx`, both Sidebar variants,
`ui/src/lib/company-routes.ts`, `ui/src/pages/Sourcing.tsx`, and their focused tests.
No new libraries or CSS tokens are required. Match the installed UI's current
compatible candidate when applying this navigation-only update; preserve existing
Knowledge, Artifacts, Marketing, and plugin functionality. Back up UI assets and
switch the HTML entry only after the new hashed assets have been copied. No server
restart or migrations are required.

Checklist:
- [x] Confirm repository, local rules, dirty worktree, and existing navigation.
- [x] Reuse focused Paperclip memory and query its scoped Graphify graph.
- [x] Record navigation requirements and clearly separate the proposed layout.
- [x] Add failing navigation/routing regression tests, then the empty page/routes.
- [x] Pass focused tests, UI typecheck, and compatible UI build.
- [x] Back up and apply the navigation-only operating UI update.
- [x] Verify menu click, direct route, unprefixed redirect, and reload with Aside.
- [x] Reconcile this record with actual evidence and remaining integration work.

Verified on 2026-10-07:
- Red test: `pnpm exec vitest run ui/src/components/Sidebar.test.tsx
  ui/src/lib/company-routes.test.ts` failed in the four new Sourcing expectations
  before implementation (55 existing tests passed).
- Focused tests: add `ui/src/pages/Sourcing.test.tsx` to the above command;
  three files / 60 tests passed.
- Broader UI regression: `pnpm exec vitest run ui/src/pages/Marketing.test.tsx
  ui/src/pages/Knowledge.test.tsx ui/src/components/Sidebar.test.tsx
  ui/src/lib/company-routes.test.ts ui/src/pages/Sourcing.test.tsx`;
  five files / 133 tests passed.
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`, and changed tracked-file
  `git diff --check` passed. Existing Vite configuration, CSS highlight, and
  bundle-size warnings remain; no unrelated cleanup was performed.
- `tmp/sourcing-dev/navigation-update.mjs --prepare|--apply|--verify` built and
  applied the UI-only compatible candidate. Both Sidebar variants are ported;
  the first browser check caught a missing production-variant port, which was
  corrected before final verification. The served asset entry matches the built
  candidate, not merely the copied file. Backups and receipts are under
  `tmp/sourcing-dev/production-backup/` and `navigation-candidate/`.
- Operating API checks passed for health, plugins, Marketing, Artifacts, and
  artifact folders. Hindsight and Marketing Drafts plugins remain ready. No
  server restart, database migration, or provider writes were performed.
- Aside account u1 verified the Work menu after Marketing, menu click to
  `/DOB/sourcing`, `/sourcing` redirect to the company route, and reload. At
  viewport width 1485px, document width was 1485px, with no horizontal overflow.
  The placeholder contained no action buttons, inputs, or product table.
  Screenshot: `/Users/ydy1412/.aside/u/1/sessions/2026-10-07_YIBzyoSkRZZFlZxG/artifacts/sourcing-menu.png`.
- Existing scoped AST graph refreshed with 51 source files, 600 nodes / 952
  edges. Its raw extraction reports dangling references and collapsed edges;
  the graph is navigation evidence, not runtime or complete dependency proof.

Remaining: layout approval and implementation, native shopping-mall tools, project
binding/permissions, actual product/queue integration, mobile layout validation,
and separately approved live collection/marketplace registration tests.

No Auto Sourcing integration or actual sourcing/publication test is part of this
navigation change. Do not check the proposed layout or future tools as implemented.

## Display-name correction (2026-10-07)

Requested: replace the narrower Sourcing label with Shopping mall management and
include sourcing, product uploads, and orders in the proposed navigation scope.
Only labels, accessibility names, tests, and this layout proposal change now.
Do not add operational order/upload endpoints or execute marketplace actions.

- [x] Update approved naming and proposed tab responsibilities before code edits.
- [x] Rename both sidebar labels, heading/breadcrumb, and focused expectations.
- [x] Run navigation/page tests and UI typecheck/build.
- [x] Back up/apply the compatible UI and verify the new name with Aside.
- [x] Refresh scoped graph, review the diff, and reconcile final evidence.

Rename validation: the same three focused test files passed all 60 tests;
`pnpm --dir ui typecheck`, `pnpm --dir ui build`, the compatible candidate build,
and changed-file `git diff --check` passed. UI-only backup/apply preserved the
baseline API checks and existing plugins; no server restart or database changes.
Aside u1 verified the menu, heading, breadcrumb/browser title, unchanged route,
and absence of the old sidebar label. At 1485px there was no horizontal overflow.
Screenshot: `/Users/ydy1412/.aside/u/1/sessions/2026-10-07_emBNIfhyQuW3ZSOv/artifacts/shopping-mall-management.png`.
Scoped Graphify outputs refreshed (51 files, 600 nodes, 952 edges). The three
workflow tabs and actual sourcing/upload/order operations remain proposed, not
implemented by this naming correction.


## Order status tabs and period filtering (2026-10-08)

User request: defer product processing and improve the order workspace. Replace
status selection with top tabs ordered New orders (Paid), Purchase orders
(Preparing), Shipping (Shipped/InTransit), Delivered, Unknown, Untracked and All.
These tabs filter stored marketplace states; Purchase orders does not claim a
supplier purchase was executed. Preserve all-order default and legacy links.

Add an order-date period button with Today, inclusive last 7/30/90 days, All,
and custom start/end dates. Persist from/to, status/search/account in the URL.
Changing filters resets pagination and selected detail; paging/detail/reload
retain the period. Filter all matching rows before totals and pagination using
Asia/Seoul midnight inclusive start and exclusive midnight after the end date.
Date-less orders remain visible for All; do not assign an invented order date.

Extend optional from/to through existing native worker, SDK, host and .NET order
API/repository. Both dates or neither are required; malformed/reversed ranges
must fail. No schema migration, new order storage, provider polling, purchase,
shipping or cancellation action. Existing explicit recent-31-day provider sync
keeps its own window and must not run on tab/period changes.

Use existing Radix tabs/popover and design tokens; horizontally scroll status
tabs on narrow screens. Period selection stays keyboard accessible and exposes
an error for incomplete/reversed input.

Execution checklist:
- [x] Implement status tabs and URL-persisted period controls.
- [x] Extend and validate the scoped native/HTTP/EF query contract.
- [x] Verify UI interactions and real SQLite/HTTP date boundaries/pagination.
- [x] Run focused type checks/builds/token gates and review the change.
- [x] Apply the verified local UI/API update with backups and check through Aside.
- [x] Reconcile actual results and remaining limits.


Verified follow-up evidence (2026-10-08):
- Kickoff: Dovix Hindsight bank queried for order/date decisions; only relocation/cleanup context was found. Existing scoped graph queried for SourcingOrders, sourcingApi and native host. Current source contracts determined the implementation.
- UI: `pnpm --filter @paperclipai/ui exec vitest run src/components/SourcingOrders.test.tsx src/pages/Sourcing.test.tsx`: 26 passed. Tests cover tab order, period preservation, inclusive Korean seven-day calculation, page/detail reset, reload links, invalid custom dates and All-period reset without provider sync.
- Host authority: `pnpm --filter @paperclipai/server exec vitest run src/__tests__/auto-sourcing-plugin.test.ts`: 4 passed; date shape/pair/order rejection added.
- Native plugin: 3 tests passed, including forwarding dates with authenticated company scope.
- Auto Sourcing: actual SQLite/loopback HTTP date-boundary test passed; all 128 non-live tests passed. Period filters precede count/pagination, retain account scope and exclude unknown dates only when bounded.
- UI (`tsc -b`), server (`tsc --noEmit`), SDK and native plugin type checks passed; token gates clean; native plugin and compatible operating UI builds passed. Existing Vite/CSS/bundle warnings remain. The current compatible UI was recovered from the preserved navigation archive, matched to the prior installed HTML hash, and only SourcingOrders sources were ported.
- Applied the .NET service, native host worker and hashed UI assets while all related jobs were idle. Backups and private receipts: `tmp/sourcing-dev/orders-filters/`. After the .NET restart, a pooled HTTP read returned ECONNRESET; fresh health, code hashes and backup comparisons confirmed the completed update. Remaining host/UI work resumed without replaying the .NET install. Final health and all 48 HTML-referenced assets passed.
- Order records matched the SQLite backup; the Marketing publication COPY data matched the PostgreSQL backup. No marketplace requests or writes were made by tab/period checks. Explicit refresh still uses the recent 31-day provider window.
- Aside u1 verified operating tabs, a custom single day (four stored Shipping rows dated October 4), reload restoration, recent seven days (October 2-8), All-period reset and no alerts/outer overflow at 1485px. Screenshot inspected: `/Users/ydy1412/.aside/u/1/sessions/2026-10-08_Nu58IBvMn4hnnLUe/artifacts/orders-tabs-period-desktop.png`.
- Aside keyboard ArrowRight moved Shipping to Delivered after the focus update; the Preparing tab displayed the expected empty state. At a 390px order-container width, scrollWidth remained 390px, status tabs scrolled internally and the period button fit. This is a narrow-container check, not mobile viewport emulation.
- Code-only scoped Graphify refresh: Dovix 662 nodes/1065 edges, Auto Sourcing 2527 nodes/5121 edges. All unselected node IDs preserved. Auto Sourcing automatic deduplication would remove historical unselected IDs, so it was disabled for the scoped merge; the earlier graph was retained until the preservation check passed. No semantic processing or hooks.
- Reviewed the task diff against kickoff baselines and checked whitespace. No new persistence root, schema, dependencies or speculative abstraction. No commit/PR was requested.

Remaining verification: the installed Aside page has no viewport-resize method;
Aside window-resize/list APIs and codemode CLI are also unavailable. Narrow
container layout is checked separately; this does not claim real mobile-device
or mobile-viewport testing. Actual agent invocation and product-processing tools
remain outside this UI follow-up.

Rollback: restore the backed-up `auto-sourcing-plugin.js` and `index.html`,
restore the saved Auto Sourcing release binaries and restart the affected local
services while idle. Keep newer data and hashed assets; do not restore an older
database over current work.

## Operator shipping extension (2026-10-08)

User request: checkbox bulk selection, courier radios, tracking input and dispatch.
Selected Preparing orders on the current page share a courier but use individual
tracking numbers. Selection resets with list scope; details alone preserve it.
The new dispatch dialog reviews fresh order eligibility and creates existing
Auto Sourcing confirmation tickets, then the user sends eligible reviewed orders.
Results distinguish verified, rejected, blocked, partial and unknown/pending;
never automatically replay an uncertain external write. Official invoice docs
require Preparing, so Paid orders must be prepared before shipping.

Plan: retain .NET SQLite/adapters/tickets as owner; add single-shipment
preview/dispatch/status endpoints and an explicit board-only
`auto-sourcing.shipping.write` capability across shared/SDK/protocol/native host.
Existing three agent tools remain read-only. Host checks company/project/account
and authentic operator scope, resolves its service token privately, and audits
operation ticket/state without tracking numbers or customer data. UI coordinates
bounded per-order requests and shows per-order results. Validate server authority,
actual SQLite/HTTP/protocol behavior, UI interaction and compatible runtime builds.
No migrations, new database, watcher, hook or autonomous shipping tool.

- [x] Requirements/plan recorded before code changes.
- [x] Shipping endpoints/domain and scoped capability bridge implemented.
- [x] Checkbox/radio/individual input/review/results implemented and verified.
- [x] Tests/type checks/builds/token gates/final review complete.
- [x] Operating host/UI applied with backups and Aside verification.
- [x] Scoped graph and final implementation documents reconciled.
- [ ] Real marketplace shipping write (requires actual tracking/targets).

Sources: https://developers.coupang.com/ko/api/shipments/uploading-waybills ;
https://developers.coupang.com/ko/api/logistics/courier-code ;
https://developers.coupang.com/ko/api/shipments/single-po-query-using-shipmentboxid .

Dispatch validation and application evidence (2026-10-08):
- Hindsight: both repository banks queried; Dovix relocation context and Auto
  Sourcing database/adapter ownership informed the work. Existing scoped graphs
  were queried and current code verified. No source-of-truth migration to Space.
- `SourcingOrders.tsx` adds page-scoped eligible checkboxes and select-all;
  `SourcingDispatch.tsx` adds explicit courier radios, individual string inputs,
  fresh preview, confirmation and per-order results. Selection clears on scope
  changes; a dialog freezes company/project/account/selected-order scope.
  Duplicate clicks are locked. Lost responses recover ticket status only and
  never repeat the dispatch request. Processing-record checks read local tickets;
  they do not remotely reconcile or unblock an uncertain ticket.
- Board-only `auto-sourcing.shipping.write` is registered throughout shared,
  SDK/RPC, capability validation, host and native plugin version 0.2.0. The three
  existing agent read tools remain unchanged. Host rejects agent/missing/foreign
  scope and unbound accounts before calling the fixed private loopback API.
- UI command: `pnpm --filter @paperclipai/ui exec vitest run
  src/components/SourcingOrders.test.tsx src/components/SourcingDispatch.test.tsx
  src/pages/Sourcing.test.tsx`: 31 passed. Host authority tests in
  `server/src/__tests__/auto-sourcing-plugin.test.ts`: 5 passed; native plugin
  tests: 4 passed; SDK `host-client-factory.test.ts`, `worker-rpc-host.test.ts`
  and `testing-actions.test.ts`: 45 passed. Auto Sourcing Release non-live suite:
  146 passed. Total 231 distinct tests; UI tests use simulated API responses.
- UI/server type checks, SDK/shared builds, native plugin typecheck/build,
  UI token gates and compatible Vite build passed. Existing Vite/CSS/chunk
  warnings remain. Final scoped code review and whitespace check passed; existing
  unrelated dirty work was preserved. No commit or PR was requested.
- Actual .NET domain, SQLite, authenticated loopback HTTP and Coupang adapters
  were exercised against an isolated pinned-TLS protocol fixture. This verifies
  successful/partial/aborted responses and durable no-replay behavior without
  customer credentials or marketplace writes. Actual read-only Coupang detail,
  courier and three history entries were also verified using a private database
  copy. The latter discovered and fixed the real `data.details` object envelope.
- Applied while sync jobs and Sending tickets were idle. Private backup/receipt:
  `tmp/sourcing-dev/orders-dispatch/backup-1791469577646` and `applied.json`.
  Selected host/SDK/shared runtime files, native plugin, .NET release and
  compatible UI entry were applied. Service readiness/auth rejection, native
  shipping-status bridge and all 48 referenced UI assets passed. Order records
  and Marketing publication records match their backups; Knowledge, Marketing
  and Artifacts API/plugin checks passed. No SQL migration was needed.
- Aside u1 verified operating checkbox/action visibility, stored order detail,
  the Preparing empty state, tab switching, no alerts and no document overflow
  at 1485px. Stored counts remain 49 total and 0 Preparing, so the actual dialog
  cannot be opened with an eligible live order. Dialog/selection interactions
  are covered by UI tests; no live modal or mobile-viewport proof is claimed.
  Screenshot inspected:
  `/Users/ydy1412/.aside/u/1/sessions/2026-10-08_eBmjxU7IJngcXPXA/artifacts/orders-dispatch-operating.png`.
- Deterministic scoped Graphify refresh: 12 code files per repository; Dovix
  1444 nodes/2013 edges, Auto Sourcing 2572 nodes/5163 edges. All unselected node
  IDs preserved, deduplication disabled, zero semantic tokens, no hooks/watchers.
  These outputs describe source structure, not runtime verification.
- Selected reusable adapter/ticket failure causes and the operator-only shipping
  boundary were deduplicated, stored in the Auto Sourcing project Hindsight bank
  and verified by recall under document
  `operator-dispatch-verified-contract-fixes-2026-10-08`. No customer identifiers,
  invoice numbers, credentials or full conversation were retained.

At this dispatch checkpoint, new-order preparation and live eligible-order modal
checks were pending. The preparation follow-up below completes that UI flow and
modal verification. Remaining: real invoice POST/readback, mobile viewport,
split shipments, invoice changes and resolution of uncertain tickets.
No customer order was dispatched during verification.

Rollback: after checking sync/Sending jobs are idle, disable the shipping plugin
before reverting its host capabilities, restore the selected backed-up runtime
files, UI entry and .NET release, and restart the affected local services.
Preserve newer database/ticket records and hashed assets; do not replace current
data with the backup databases.

## New orders -> Preparing -> invoice registration (2026-10-08)

User request: a button updates new orders to product preparation, and the
Preparing list exposes invoice registration. Replace the ambiguous 발주 tab label
with 상품준비중. Paid-tab checkboxes select eligible Paid orders; its action opens
a fresh per-order review then confirmed preparation. Preparing-tab checkboxes
retain courier radios, per-order invoice inputs and explicit dispatch, with the
action labeled 운송장 등록·발송. Current-page maximum remains 20, selection resets
with scope, and frozen dialog context prevents retargeting across accounts.

Extend existing operator-only autoSourcing.shipping with prepare-preview,
prepare and prepare-status operations. Retain auto-sourcing.shipping.write for
this shipping-workflow precondition; no new agent tool/capability or credential
exposure. Strict host schemas and area/kind/target checks protect preparation
and shipping tickets. Auto Sourcing remains domain/adapter/SQLite owner and
performs PATCH only after operator confirmation, then real detail readback.
Reuse the batch modal with a preparation mode that hides invoice controls;
show independent results and a link to 상품준비중 after verified changes.
Unknown results use status-only recovery without repeat mutation.

- [x] Requirements/plan recorded before code.
- [x] Preparation bridge/domain endpoints implemented with scope/no-replay checks.
- [x] New-order checkboxes/button and Preparing invoice-registration flow verified.
- [x] Tests/type checks/build/token gates/final review complete.
- [x] Compatible local services/UI applied with backups and Aside checks.
- [x] Scoped graph/documents reconciled; real-write limitations recorded.

Official contract: https://developers.coupang.com/ko/api/shipments/changing-the-status-to-product-in-preparation
No real customer preparation PATCH or invoice POST is a development test.

Final preparation evidence (2026-10-09 KST):
- New orders use page-scoped checkboxes and 선택 주문 상품준비중 처리, fresh review,
  explicit confirmation and independent results. Verified results expose
  상품준비중 목록 보기. The 상품준비중 tab exposes 운송장 등록·발송, shared courier
  radios and a separate string invoice field per selected order. Scope changes
  clear selection; frozen dialog context, busy locks and status-only recovery
  prevent duplicate or retargeted mutations. Maximum batch remains 20.
- Existing auto-sourcing.shipping.write now includes prepare-preview/prepare/
  prepare-status as a shipping precondition. Native plugin 0.3.0 uses the same
  authenticated board action; no new capability or agent mutation tool. Host
  strict schemas reject preparation invoice fields, missing/bad confirmation and
  agent/foreign/unbound scope. Exact returned ticket area/kind/target is required.
- 238 distinct tests passed: Auto Sourcing Release non-live 148 (20 dispatch/
  preparation integration cases), UI 34 (`SourcingOrders.test.tsx`,
  `SourcingDispatch.test.tsx`, `Sourcing.test.tsx`), host authority 6, native
  `plugin.spec.ts` 5 and SDK 45. Actual .NET/SQLite/HTTP/adapters used a pinned local
  TLS provider fixture; UI APIs are simulated. Real customer writes remain
  unverified. Relevant type checks/builds/token gates passed; existing Vite/CSS/
  chunk-size warnings remain. Final review used the scoped kickoff baselines;
  existing unrelated dirty work was preserved.
- Applied compatible host service, native plugin, .NET release and three selected
  UI sources while sync/Sending/background jobs were idle. Backup:
  `tmp/sourcing-dev/orders-dispatch/preparation/backup-1791472236437`; receipt:
  `tmp/sourcing-dev/orders-dispatch/preparation/applied.json`. Health/auth rejection,
  native preparation/shipping status bridges, 48 UI assets and existing
  Knowledge/Marketing/Artifacts operating checks passed. Order/publication records
  matched backups at application. Read-only previews subsequently saved legitimate
  current order metadata; restoring an old database would lose newer evidence.
- Aside u1 tested actual New-tab selection and preparation review. Fresh Coupang
  GET showed both cached Paid orders were already Preparing; 0 eligible changes
  disabled confirmation, and local snapshots updated from that response. Actual
  Preparing-tab selection opened invoice registration with 7 radios and 2 empty
  string inputs. Closing cleared selection; the existing tab remains open on
  Preparing. No customer PATCH/invoice POST, alerts or document overflow occurred
  at 1485x870. Inspected screenshots:
  `/Users/ydy1412/.aside/u/1/sessions/2026-10-09_sYR7TfIgRVv0Lczv/artifacts/orders-preparation-review.png`
  and
  `/Users/ydy1412/.aside/u/1/sessions/2026-10-09_izwIZkzXWFcvZvjx/artifacts/orders-preparing-invoice-dialog.png`.
- Scoped graph refresh updated 7 Dovix sources (1446 nodes/2014 edges) and 3 Auto
  Sourcing sources (2584/5177), preserving unselected node IDs. Project memories
  were queried, prior domain ownership/no-replay facts verified from source.
  No semantic scan, global tooling change, new database, migration or hook.
- Reusable verified preparation/ticket and stale-order protection facts were
  submitted to the existing Auto Sourcing Hindsight project bank. Async storage
  was accepted; bounded read-back has not returned the new document
  `operator-preparation-flow-2026-10-09`, so memory extraction remains pending.
  No customer/order identifiers, tracking numbers, credentials or transcript.

Remaining: real customer preparation PATCH/invoice POST and successful provider
readback, mobile viewport, actual agent reads and uncertain-ticket resolution.
Cached-order freshness can differ from the provider; the explicit review reads
current details and blocks stale actions. Automatic list refresh or invoice
spreadsheet import could improve daily operation in a later change.
Rollback follows the existing selected-file procedure and preserves newer data.

## Database-backed carrier catalog (2026-10-09)

User request: replace hardcoded courier choices/validation with DB reference data
that changes without recompilation/restart, and inspect similar hardcoding.
Auto Sourcing SQLite owns shipping_carriers (provider/code, name, enabled,
sort_order, invoice_lengths JSON, numeric/alphanumeric invoice_format, aliases
JSON, tracking_supported). One-time EF migration seeds the existing seven rows;
startup does not reseed. Authenticated /shipping/carriers uses bound account
provider; native carriers read keeps existing company/project/account authority.
Host validates response shape and code syntax; SQLite owns active membership,
invoice rules and provider-name mapping. Ticket input binds current policy and
the real adapter checks fresh rules before POST. No new capability/write tool.

Replace SourcingDispatch's static list with scoped native data; refresh every
five seconds while open/idle and on focus (pause interval during a batch action).
Derive hints/input mode from returned rules; errors block action, and there is
no static fallback. Preserve existing
operator confirmation/no-replay flow. Add actual SQLite/migration/HTTP/protocol,
UI refresh/error and authority checks, then apply compatible selected runtime/UI
files with backups. Aside verifies a real DB-row change appears without restart;
do not send a customer invoice. Audit nearby sourcing/publishing/marketing
operational data; distinguish those findings from code-owned protocol/state rules.

- [x] Scope/source/memory/graph and contract checked; plan recorded before code.
- [x] Carrier table, fresh validation and scoped HTTP/native reads implemented.
- [x] Dynamic UI options/refresh/error behavior implemented and tested.
- [x] Migration/data preservation, tests/builds/types and final review verified.
- [x] Compatible services/UI applied and actual Aside DB-change propagation checked.
- [x] Adjacent hardcoding findings, scoped graphs and final evidence reconciled.

Final carrier evidence (2026-10-09 KST):

- `shipping_carriers` is in Auto Sourcing `var/sourcing.sqlite`, not a new Dovix
  database. `20261008193957_ShippingCarrierCatalog` seeds seven verified rows once;
  SQLite version remains 3. Display/enable/order/length/format/aliases/tracking
  support and current invoice validation read live rows. No compiled fallback.
  Host allows bounded code syntax; the domain checks membership/current rules.
  Operator confirmation binds invoice policy; the adapter validates again before
  POST. Existing company/project/account/operator authority is preserved.
- Local tests: .NET Release 152 non-live (`ShippingCarrierCatalogTests.cs`,
  `DispatchWorkspaceTests.cs` plus existing suite), UI 36
  (`ui/src/components/SourcingOrders.test.tsx`, `SourcingDispatch.test.tsx`,
  `ui/src/pages/Sourcing.test.tsx`), host 7
  (`server/src/__tests__/auto-sourcing-plugin.test.ts`), plugin 6
  (`packages/plugins/plugin-auto-sourcing/tests/plugin.spec.ts`), SDK 45
  (`packages/plugins/sdk/tests`); total 246. Scoped Vitest runs, `tsc -b` UI,
  server `tsc --noEmit`, SDK/shared builds, plugin typecheck/build, compatible
  Vite build and selected host import probe passed. Use the existing .NET 8
  `DOTNET_ROOT`; the exact .NET command is recorded in Auto Sourcing tasks.
  `node scripts/check-token-gates.mjs` passed all four gates; `git diff --check`
  passed both repos. Separate `pnpm check:tokens` (npm publication privacy check)
  fails on the pre-existing personal absolute path at root README.md:6; that
  unrelated document was preserved. No npm publication was requested/performed.
  Existing Vite native configuration/CSS highlight/chunk warnings remain.
- After idle checks, backed up selected host/UI, .NET release, SQLite and
  Postgres to `tmp/sourcing-dev/orders-dispatch/carriers/backup-1791489329732`.
  Stopped Auto Sourcing service, ran staged CLI `database migrate --db PATH`,
  then installed the new service and native plugin 0.4.0/compatible UI.
  Exact migration backup:
  `../auto-sourcing/var/sourcing.sqlite.backup-20261008195532-97020c87cbb54527afd67d6a9de9adc7`.
  `applied.json` and `final-verification.json` in the same task directory record
  ready services, carrier/preparation/shipping native bridges, 48 served UI
  assets, unchanged order/Marketing publication hashes, ready Knowledge/Marketing/
  Auto Sourcing plugins and preserved authentication/Origin rejection.
- Aside u1 reused the existing Preparing tab. Actual modal showed seven seeded
  radios and two empty invoice strings. Inserted official `LOGISVALLEY` row
  (로지스밸리, numeric 12 digits) into operating DB: radio count became eight
  without rebuild/restart. Timer-only disable/re-enable showed removal/restoration
  2.238/4.347 seconds after DB updates, with no focus/click/reload after each edit.
  Auto Sourcing PID was unchanged throughout DB edits. Final row enabled and
  modal closed/selection cleared. Selected-row hint reflected DB; screenshot
  inspected at 1485x870 with no alerts/outer horizontal overflow:
  `/Users/ydy1412/.aside/u/1/sessions/2026-10-09_70WP0IQvHjuzg22g/artifacts/orders-db-carrier-catalog.png`.
  Evidence: `tmp/sourcing-dev/orders-dispatch/carriers/db-propagation.json`.
  Zero real customer preparation PATCH/invoice POST. Newly configured provider
  code still requires official support/account acceptance; insertion adds no
  marketplace integration. SQL field/example guidance is in Auto Sourcing plan.
- Scoped AST graph refresh used existing output roots: 6 Dovix sources
  (1448 nodes/2018 edges), 13 Auto Sourcing sources (2630/5179), all unselected
  IDs preserved. Other files remain historical graph context. No semantic scan,
  new bank/index root, hook, watcher or global setup change.
- Focused Hindsight recalls were checked against local evidence. Prior pending
  preparation document is now retrievable. New selective carrier ownership/
  fresh-policy and native UI/timer facts were deduplicated, retained to their
  respective existing project banks, then recalled with matching document IDs
  and source metadata (`shipping-carrier-reference-data-2026-10-09`,
  `sourcing-carrier-catalog-ui-2026-10-09`). No customer identifiers, invoices,
  credentials or transcripts were retained.

Adjacent hardcoding audit (bounded to order/sourcing/publishing and nearby
Marketing settings; these findings are deferred, not implemented in this task):

| Priority | Operational literal | Current source | Suggested ownership / boundary |
| --- | --- | --- | --- |
| Next | Order labels and tab order | `ui/src/components/SourcingOrders.tsx:12` and `:13` | Dovix DB display metadata; actual state codes and eligible transitions stay in code. |
| Next | Today/7/30/90-day shortcut choices | `ui/src/components/SourcingOrders.tsx:124` | Dovix DB period presets; external API's 31-day sync contract remains enforced. |
| Later | SNS platform labels/choices | `ui/src/components/MarketingChannelForm.tsx:8`, `packages/shared/src/validators/marketing.ts:3` | Dovix DB labels/visibility for implemented platforms; new integrations require code and actual verification. |
| Later | Local LLM models `translategemma:4b`, `qwen2.5:1.5b` | Auto Sourcing `ExternalIntegration/Translation/OllamaProductTranslator.cs:13`, `OllamaPublicationEnricher.cs:17` | Auto Sourcing operational model settings with available-model/response validation. |
| Design needed | CNY-only source/publication contract | Auto Sourcing `BusinessDomains/Upload/ProductPublishing/Service/PublicationPreparation.cs:14`, `Sourcing/ProductImport/Service/CollectedProductMapping.cs:27` | Currency/price conversion design; the exchange rate is already an input, not a fixed rate literal. |

Sales accounts, project/account bindings and stored orders already use persisted
data; provider category metadata is read through the existing external contract.
The next practical improvement is an operator carrier-settings screen plus
period/tab display configuration, so routine changes do not require direct SQL.
No generic universal code-table layer is required to achieve those workflows.

Remaining: editing UI/configuration work above, actual customer/provider shipping
readback, mobile viewport, actual agent invocation and uncertain-ticket remote
reconciliation. Rollback preserves newer order/ticket data; do not restore old DB
over legitimate operations. Existing selected-file runtime procedure still applies.

## Shipping forwarders — first login milestone (2026-10-09)

### Requirements

The user requested forwarder registration with URL and saved login credentials,
and a forwarder action on Preparing orders. This task explicitly uses an external
Chrome browser rather than Aside. Next Shipping is the first supported automatic
login provider; its official homepage is https://www.next1688.com/ and observed
login page is /Front/Join/Login.asp?gMnu1=207&gMnu2=20702. Initial acceptance is
opening the login page, filling the saved ID/password and submitting login.
Submitting is not proof of authenticated account access. No shipping application
or customer-order submission is authorized by this milestone.

### Actual plan

- Keep forwarder metadata in a company/project-scoped Dovix table, with a reference
  to an existing local_encrypted company secret containing credentials. Pin its version with the URL snapshot; concurrent edits cannot switch the password resolved for an old URL. List/API
  responses never contain passwords. Registration/update is board-authorized;
  verify project ownership and audit only non-sensitive IDs.
- Reuse existing schema/shared/API/UI layers. Preparing orders get a forwarder
  chooser and registration dialog. Update credentials by replacement only, with
  an empty password preserving the existing secret. Delete forwarder and secret.
- Use locally installed headed Chrome with an isolated browser profile/session,
  launched by product code through playwright-core. No account switch, global
  browser security change, remote browser service or bundled browser download.
  The feature runs on the Dovix host; explicitly communicate this in the UI.
- For Next Shipping, permit credentials only on the verified HTTPS origin, use
  visible #sMemId / #sMemPw inputs and the login control in that form. Other
  registered sites can open their login page; automatic submission remains
  explicitly unsupported until their form is verified. Never guess credentials.
- Test real encrypted persistence, API company boundaries/redaction, browser
  origin/failure handling using synthetic fixtures, and Preparing UI interaction.
  Inspect the official empty login page in Chrome. Real account login requires
  the user to enter credentials directly in the new registration screen.
- Preserve current dirty source and pending migrations. Generate additive Drizzle
  SQL without pruning existing snapshots. Stage/test before updating the running
  service; retain rollback and protect newer operating data.

### Execution checklist

- [x] Authentication-only follow-up passed.
- [x] Forwarder metadata migration and encrypted credentials persistence.
- [x] Authorized/redacted CRUD and browser-login endpoints.
- [x] Registration and Preparing order controls.
- [x] Targeted tests, affected types/build/token and migration checks.
- [x] Chrome UI registration/update and official Next Shipping controls verified; real login coverage labeled.
- [ ] Actual Next Shipping credential submission and authenticated-account result: user account has not been entered; native new-window inspection is blocked by the Mac lock.
- [x] Final diff, scoped graph and documentation reconciled.

### Implemented contract and verification

Checked 2026-10-09. `sourcing_forwarders` stores company/project, display name, homepage/login URLs, enabled flag, credential-secret reference and fixed credential version. Create/update use a single Drizzle transaction with nested secret-service savepoints; passwords and IDs are encrypted by the existing local provider. Blank credential edits preserve the version. A site-origin change requires replacement credentials. Delete removes the forwarder and soft-deletes its secret. List responses contain no credentials or secret IDs. Invalid/malformed URLs return validation errors rather than exceptions.

Company-scoped board-only routes live at `/api/companies/:companyId/sourcing/projects/:projectId/forwarders`, with POST/PATCH/DELETE and `/:id/open`. Project ownership/archive checks apply before secret resolution or browser invocation. HTTP error logging classifies credential-bearing routes as private; audit details contain resource IDs and browser status only. Existing browser-session Origin middleware remains intact; explicit board bearer keys retain their existing Origin exemption. Unauthorized operating reads returned 401, not the initial verification script's assumed 403. An invalid-origin **bearer** request reached payload validation (400), which is the existing bearer contract, not a browser-session CSRF test. A session-based regression case proves untrusted Origin is rejected with 403 before credential writes.

Preparing has a project-level management button and an order-level forwarder chooser; selecting a provider does not change or submit the order. New providers are DB records. Next Shipping's verified implementation uses visible `#sMemId`, `#sMemPw` and `a[onclick="fnLoginM();"]` on its exact HTTPS origin. Other sites open their configured page for manual login. Chrome uses a temporary isolated profile on the Dovix host, at most four live windows, duplicate-open protection, account/URL binding checks and app-shutdown cleanup. `login_submitted` means the login control was clicked; no authenticated success is inferred.

| Check | Result / evidence |
| --- | --- |
| Authentication suites | 108 passed; `tmp/continuity-dev/authentication-isolated.log`. |
| Forwarder DB/API/browser/UI selection | Final 4 files / 40 tests passed; `tmp/continuity-dev/forwarder-final-tests.log`. Files: `server/src/__tests__/sourcing-forwarders.test.ts`, `sourcing-forwarder-browser.test.ts`, `ui/src/components/SourcingForwarders.test.tsx`, `SourcingOrders.test.tsx`. Covers encrypted persistence, redaction/audit, company/project/agent boundaries, disabled/archived resources, secret rotation/version pinning, browser Origin checks before each credential/action (including redirect after ID fill), broken login controls, session CSRF, malformed URLs, registration/update and order chooser. |
| DB/shared/server/UI types; DB/server/shared compilation | Passed; `forwarder-db-types.log`, `forwarder-shared-build.log`, `forwarder-server-build.log`, `forwarder-final-server-types.log`, `forwarder-final-ui-types.log`. |
| Additive migration checks | Passed; `forwarder-migration-check.log`. Generated `0301_sourcing_forwarders.sql` and snapshot without pruning existing snapshots/pending migrations. |
| Token gates and final diff whitespace | Passed; `forwarder-token-check.log`, `git diff --check`. |
| Installed-version compatibility | Actual old runtime imports, fresh runtime migrations, encrypted CRUD/rotation/delete and redacted reload passed; `tmp/sourcing-dev/forwarders/compatible-verified.json`. |
| Compatible UI build | Passed from actual compatible UI directory; `forwarder-compatible-ui-build.log`. An initial filtered build selected the main workspace; it was superseded by the explicit compatible-directory build and fresh served-file inspection. |
| Chrome fixture interaction | Real create/edit against isolated Postgres and native product Chrome launch/navigation passed, with synthetic stored credentials never sent to Next Shipping. For the external-open check, login URL was temporarily the public homepage, so automatic login was intentionally not invoked. Screenshot `tmp/sourcing-dev/forwarders/browser-fixture.png`. Native window inspection was denied by the locked Mac; existing Chrome extension could inspect Dovix and the official empty login page but did not attach to the new isolated Chrome. |
| Operating application | Selected compatible runtime plus UI applied with backup. Healthy authenticated forwarder API, unauthenticated rejection, 48 served UI assets, ready Hindsight/Marketing/Auto Sourcing plugins, unchanged order and marketing-publication hashes; `tmp/sourcing-dev/forwarders/applied.json`, `forwarder-live-check.log`. |
| Operating Chrome form | Preparing management/add dialog opened with actual backend; Next Shipping URLs prefilled, credentials blank, no production test record created. Screenshot `tmp/sourcing-dev/forwarders/forwarder-registration.png`; page retained for user input. |

The installed service remains version `2026.1001.0`; source migration `0301_sourcing_forwarders` maps to its additive runtime migration `0287_sourcing_forwarders` with the same SQL/hash. Other source migrations and continuity POC runtime changes were not applied. Selected artifacts/backup and mapping are recorded in `tmp/sourcing-dev/forwarders/candidate/manifest.json` and `applied.json`; database dump and original runtime/UI are in `backup-1791505945008`. A final malformed-URL guard was tested and applied before the final health check. Do not rerun the one-time installation against a later runtime without restaging/hash validation. Roll back selected files/UI only after idle checks; preserve newer forwarder/order data and do not restore the old DB over legitimate operations.

Memory: focused existing project-bank recalls had carrier ownership/previous constraints but no forwarder design; current local source remained authoritative. Scoped code-only Graphify was built/refreshed in the existing `graphify-out` because graph.json was absent; nine selected sources, zero semantic/paid extraction, no hooks/watchers/global setup changes. Pinning and storage/browser milestone boundaries were retained and read back with matching source metadata in existing Dovix bank, document `dovix-sourcing-forwarder-login-milestone-2026-10-09`. No customer identifiers, credentials or transcripts retained.

Remaining acceptance: the user must enter their real Next Shipping ID/password directly in the prepared registration screen and unlock the Mac. Then invoke the order's forwarder action and verify actual fields, submission and account result in the newly opened Chrome. CAPTCHA/MFA, if present, remains user-controlled. Additional providers require their own verified form implementation; their stored metadata alone does not add automatic-login capability.

Final handoff reconciliation: scoped AST is 55 nodes / 77 edges, with selected-source SHA256 freshness manifest in `graphify-out/scope.json`. Current installed hashes for all 23 selected runtime files and the source/runtime migration SQL match `tmp/sourcing-dev/forwarders/final-review.json`. Keep `selected-runtime/`, manifest, screenshots, verification records and rollback backup; the disposable 673 MiB compatible runtime/dependency clone was removed after validation. The one-time compatibility scripts require restaging their pinned baseline to run again. The compact live registration form shows ID/password and Save together. Its temporary search filter was cleared before retaining the live Chrome tab for user input.


## Shopping mall management settings menu (2026-10-09)

User decision: add `쇼핑몰 관리 설정` immediately below `주문` in the
existing sourcing sidebar. Consolidate delivery-forwarder registration, encrypted
account updates, enable/disable and deletion there. Order rows retain their
Preparing forwarder chooser and browser-open action; the chooser links to settings
instead of exposing administration controls. Existing company/project authority,
credential storage, backend APIs and Chrome login behavior remain unchanged.

Implementation: extend `sourcing-views.ts` and `SourcingSidebar.tsx` with
`view=settings`; branch in `Sourcing.tsx` after project selection. Reuse
`SourcingForwarders.tsx` as an inline settings section or an order-only dialog.
No new settings table, top-level directory or backend abstraction is needed.
Preserve project on navigation, clear workflow filters, prevent unscoped queries
without a valid selected project, and remount on company/project change.

- [x] Add menu after Orders and a directly addressable settings screen.
- [x] Move forwarder administration out of Orders; retain chooser/open action.
- [x] Validate navigation, registration/edit/open-error behavior and scoped project switching.
- [x] Pass focused UI tests, typecheck/build and UI token gates.
- [x] Apply only compatible UI with backup and verify the operating menu.
- [x] Reconcile final evidence and refresh the scoped structural graph.

Validation (2026-10-09): focused Vitest command with
`ui/src/pages/Sourcing.test.tsx`, `ui/src/components/SourcingOrders.test.tsx` and
`ui/src/components/SourcingForwarders.test.tsx` passed 37/37; log
`tmp/continuity-dev/mall-settings-tests.log`. UI `tsc -b`, main UI Vite build,
final compatible UI Vite build, token gates and `git diff --check` passed.
Logs are `mall-settings-types.log`, `mall-settings-main-build.log`,
`mall-settings-compatible-build.log` and `mall-settings-tokens.log` in the same
verification directory. Full root suite and real Next Shipping account login
were outside this navigation-only scope.

Only five compatible UI source files were ported. Backed up prior installed UI,
overlaid new assets while preserving old hashed chunks, and atomically replaced
index.html. No server restart, database migration or API writes. Live health,
272 served asset responses and unchanged scoped forwarder metadata verified:
`tmp/sourcing-dev/forwarders/mall-settings/applied.json`. Rollback restores the
UI entry/assets from its named backup; no database rollback is needed.

Aside account u1 existing Dovix-tab attachment timed out on Page.enable; the
same account's newly owned temporary tab loaded the live screen successfully.
Its snapshot confirms menu immediately after Orders, settings title/breadcrumb,
retained Auto Sourcing project and inline forwarder region. No browser/profile
fallback or account setting changes were performed. Registration form was opened
through a fresh snapshot ref in a persistent REPL;
name, URL, empty ID/password fields, enabled control and Save/Cancel were observed.
Screenshot: `tmp/sourcing-dev/forwarders/mall-settings/registration.png`. The
owned tab was closed; no production credential/order write was submitted. An
early role-selector attempt before a fresh snapshot failed and was superseded
by this verified ref-based action.

Scoped source-only Graphify refresh: 12 files, 63 nodes / 93 edges; SHA256 freshness
manifest is `graphify-out/scope.json`. No semantic extraction, hooks or answer
store. Hindsight saved the user's new settings-location decision under
`dovix-shopping-management-settings-location-2026-10-09`, read-back matched
its document ID and source metadata. Other milestones and unverified real
account authentication remain recorded in the earlier section.


### Multiple shipping-forwarder registrations (2026-10-09)

User clarified that multiple delivery forwarders can be registered. Keep
company/project-scoped multi-record registration and per-order selection. The
same provider may have multiple independent accounts; operator-editable names
(e.g. `넥스트배송 A계정`, `넥스트배송 B계정`) distinguish them in the chooser.
Each entry already has its own UUID and encrypted secret; no one-per-project
or provider/name uniqueness restriction exists. Current source and fresh scoped
Graphify confirm the existing contract. No production/schema change is needed.

- [x] Verify same-provider duplicate registration and independent credentials
  using isolated Postgres; deleting one must not remove the other's account.
- [x] Verify multiple rows survive a new UI registration and the order chooser
  opens only the selected row ID.
- [x] Record focused validation and preserve actual-login limitations.

Verified: two focused files passed 16/16 via
`pnpm exec vitest run server/src/__tests__/sourcing-forwarders.test.ts ui/src/components/SourcingForwarders.test.tsx`.
Evidence: `tmp/continuity-dev/forwarder-multiple-tests.log`. Three new cases cover
same-provider independent encrypted accounts in real isolated Postgres, deletion
isolation, adding a third registration without overwriting existing rows, and
opening only the chosen row ID. Browser callbacks/UI APIs were mocked; real
provider authentication was not exercised. Production files/runtime/schema remain
unchanged, so no rebuild/restart/deployment was required. `git diff --check` passed.


## Product processing skill first version (2026-10-09)

Requested direction: define how sourcing products should be processed as a skill,
then let agents develop and use the tools needed for that workflow. Prioritize a
single product's evidence -> editable processing draft -> validation -> operator
review loop. Scope includes Korean option names, representative image selection
and crop plans, verified category/required attributes and unresolved inputs.
Original SKU IDs, prices, units and image sources remain immutable evidence.
Market submission, orders/shipping writes and new paid-media generation are not
authorized by this skill. No new product-processing runtime is built in this turn.

Current Auto Sourcing Paperclip manifest exposes only list-order-accounts,
list-orders and get-order. The sibling .NET product-publishing domain already has
source-evidence, enrichment, category validation and editable draft structures;
reuse those rather than inventing a second product database/engine. A skill is
instructions, not tool implementation or proof of agent assignment.

Plan: create `skills/sourcing-product-processing/SKILL.md` with operating rules
and `references/development.md` with proposed tool responsibilities, existing
source locators, collaboration/handoff and acceptance scenarios. Make current
capability discovery mandatory; describe missing crop/draft/category actions as
proposed contracts, never callable names. Read existing local rules/specs in the
actual target repo before implementing .NET tools. Do not create an index/bank
for the shared parent or copy another project's mutable state into Dovix.

- [x] Write concrete processing rules and developer handoff reference.
- [x] Validate the skill and maintained relative links/examples.
- [x] Record available/missing tools and the separate rollout prerequisites.

Delivered the two-file repo skill. Its operating mode records original-to-Korean
option mapping, crop plans vs verified output, real category/mandatory facts and
persistent draft vs proposal status. Its development reference proposes five
capability responsibilities without claiming callable tools exist. Existing
source .NET specs/models/validation were inspected read-only; no sibling-repo
files, models or database were changed. Core Paperclip skill separately gained
conditional collaboration/checkpoint guidance.

Skill-creator validation passed. The shared collaboration examples and linked
resources validated; 15 existing continuity API integration tests passed. Details
and rollout status are in `tmp/continuity-dev/skill-alignment-validated.json` and
the continuity plan's skill-alignment section. `git diff --check` passed. This is
an instruction/development artifact, not completed crop/category/draft plugin
implementation, company skill assignment, processing of a real sourced product
or marketplace integration proof.

Next recommended increment: safely stage/deploy the continuity extension and
register/assign the maintained skills through the existing company-skill mechanism;
then assign a bounded developer task for one source product's evidence read +
editable processing draft + validation/reload in the actual UI. Extend crop and
category tools within the same loop; confirm actual tool discovery and agent use.

## Approved product-processing development delegation (2026-10-09)

The user approved the recommended rollout and bounded developer assignment.
Continuity deployment and skill delivery are tracked in the continuity plan.
Assign the existing Developer_1 the first evidence -> editable draft -> validation
and reload loop; require current actual .NET repository rules/specs and the new
processing/development skill. Preserve the existing publishing domain, original
source/hash/SKU/price/unit invariants and operator edits. No marketplace submission,
order/shipping mutation, model download or paid generation is part of this task.

- [x] Verify developer workspace and attach the company processing skill.
- [x] Create a precise issue with tool discovery, scope, acceptance and test paths.
- [x] Verify actual run/skill use and inspect delivered changes and single-product
  draft/reload validation; keep missing live product evidence explicit.


## DOB-27 first processing loop (2026-10-09)

Approved local development only. Reuse PublicationDraft/EF repository; add nullable
ProcessingCompanyId/ProcessingProjectId and owned crop plans. Old CLI drafts remain
unbound and inaccessible through processing APIs. Source pool is global locally;
Dovix MUST require explicit `sourceProducts[projectId]` provider/product allowlist
in addition to existing project/account bindings, never expose the whole pool.

Exact tools (all require projectId, accountId; company comes from invocation):
- `get-processing-source`: sourceProvider="taobao", productId (allowlisted).
- `create-processing-draft`: sourceProvider, productId, skuIds (1..200 unique).
- `list-processing-drafts`: no other input; returns only bound drafts.
- `get-processing-draft`, `validate-processing-draft`: draftId; validation also expectedRevision.
- `save-processing-draft`: draftId, expectedRevision, name, items[] with sourceSkuId,
  name, options[] {ordinal,name,value}, representativeImageUrl, cropPlans[].
  Crop plan: sourceSkuId,imageUrl,sourceWidth,sourceHeight,x,y,width,height,
  outputWidth,outputHeight,purpose. All dimensions positive integers, rectangle
  bounded by declared source size. No derivative is claimed; always pending.
No original values, prices, quantities, currencies, metadata, owner fields or
publication status are writable. Unknown JSON fields are rejected.

Host RPC `autoSourcing.processingRead` requires `auto-sourcing.products.read`;
`autoSourcing.processingWrite` requires `auto-sourcing.drafts.write`.
Board data key `processing` reads; action `processing-draft` creates/saves only.
Worker derives company from run/action context; host validates current running
agent issue/project plus plugin bindings. .NET POST /processing/{source,list,get,
create,save,validate} receives trusted companyId/projectId/accountId and typed input.
Get/save/validate reject ownership mismatch. Save uses existing transactional
expected revision compare; stale validation is rejected too.

File hashes and selected SKU records are verified on every read/save/validation.
Create stores untranslated proposals without any inference/network request.
Name/options changes preserve numeric/unit tokens; duplicate proposals are saved
as separate SKU rows with field-level blocking issues. Missing metadata remains
category/requiredFields blocking; pending crops are visible and block readiness.
Processing never changes remote states or issues marketplace tickets.

Validation pending: isolated synthetic files/SQLite/API persistence, host authority,
real worker/manifest/SDK registration and UI reload. Operating service deployment,
real merchant product execution and browser proof remain separate prerequisites.

DOB-27 verification (2026-10-09): source implementation completed; 6 isolated .NET files/SQLite/HTTP tests and 2 actual worker/host/.NET integration tests passed. Supporting 42 regression + 6 plugin contracts passed. Aside u1 edited two SKUs, saved/reloaded revision 2, then saved crop plan revision 3 with category/requiredFields/crop pending. See Auto Sourcing `specs/005-product-publishing/processing-result.md` for exact paths, commands and limitations. No operating rollout or actual merchant product proof; existing historical unchecked tasks remain unchanged.

Independent review DOB-28 passed with no blocking source finding; the reviewer
reran 6 .NET and 2 real worker/host/.NET tests. Initial reviewer HTTP execution
was restricted by its sandbox loopback access; the permitted isolated rerun
passed. This is not production authentication or provider proof. The maintained
two-file skill now contains the exact six source contracts and explicit pending
runtime/category/pixel-crop boundary; validation and company reimport preserved
its existing key and developer/reviewer assignments. No automatic Qwen or
TranslateGemma call was added to this processing API.

## Uploads scope revision and multi-store catalog review (2026-10-09)

The operator defines Uploads as the catalog of existing registered products,
editable once and sent to selected stores as updates or new registrations.
Sales settings form business group → marketplace account, and a common product
can belong to multiple such combinations. Upload cards show a common product
once with its main image/name; Sourcing and Uploads use the same right-side
product editor. The first deliverable is Coupang list/detail import into the
sibling AutoSourcing SQLite database and the explicit business_1/store_1 mapping.
The queue and per-target create/update behavior follow in the next stages.

Canonical cross-project requirement/design review:
`../auto-sourcing/specs/005-product-publishing/multi-store-catalog-review.md`
(relative to the Dovix repository root). The sibling existing publishing spec,
plan and tasks contain CAT01–CAT09 and the M1–M4 checklist. Product/business/store
data and the durable queue remain AutoSourcing-owned; Dovix owns the shared
editor/plugin/access boundary. Dovix company scope is separate from a legal
business group. Unsupported stores remain visible as unsupported capabilities.

At the requirement-review checkpoint, source routed Sourcing/Uploads to SourcingProcessing, but that
account-bound Taobao draft editor does not implement imported listing cards,
the shared master-product model or the queued upload workflow. Preserve its
verified source behavior and existing order/forwarder service. This review is
documentation only: no runtime rollout, database migration, account import,
browser proof or marketplace mutation was performed.

### Implementation authorized: business/store settings (2026-10-09)

The operator approved M1–M3 implementation and added business registration,
store registration/list selection and provider-specific connection forms under
Shopping mall management settings. See CAT10 and the approved implementation
contract in the sibling canonical review. Keep forwarder settings available.
Credentials use an operator-only direct route and encrypted credential references
owned by AutoSourcing; plugin workers/agents receive only safe catalog data.
Provider names/form descriptors are DB-backed; runtime capabilities still depend
on implemented adapters. The implementation and operating evidence follow below.

### Business/store/common catalog delivered (2026-10-09)

M1–M3 and CAT10 are implemented and applied to the local operating service. Canonical actual structure, commands, limits and handoff: `../auto-sourcing/specs/005-product-publishing/catalog-result.md`. SQLite owns business/store/common product/listing/frozen queue; Dovix owns shared editor, typed scope gates, operator-only credential route and dynamic provider connection dialog. Registration atomically extends the existing project account allowlist; agents cannot submit credentials, import a seller catalog or execute marketplace writes. Unsupported providers store connection information only.

Actual SQLite/pinned local HTTPS catalog tests passed 6 final cases; source host/worker/HTTP/PG and legacy auth/processing tests passed 12; catalog UI passed 5, following the 38 order/forwarder/catalog UI regressions. Builds/types/token gates passed. Aside u1 used the actual native components against isolated databases to select a store, save its name, edit/reload a common product and complete update/create for two synthetic sellers with one card. Operating Aside confirmed the settings/business dialog, empty uploads catalog and existing order controls; no real seller mutation or fabricated business record was made.

`tmp/sourcing-dev/catalog/{preflight,applied}.json` records the selected 11-file compatibility rollout, original release/UI and database backups, final native health, 41 existing SQLite table/column-row hashes, forwarder/publication hashes and unchanged plugin config. Compatible UI starts from the existing operating baseline and retains its static assets; unrelated dirty development source was not deployed. The initial restart check raced startup, and its rollback exposed the old tmp plugin alias to canonical Dovix/new manifest. Recovery restored the new declared capability contract and awaited both HTTP and plugin readiness. Ordinary purge=false local reinstall preserves the same plugin ID and configuration and now binds the canonical Dovix path. AutoSourcing 0.5.0 has 13 tools; Hindsight and marketing remain ready.

Project Hindsight decisions were queried; changed catalog source AST was merged into existing graphs without losing unselected nodes or paid semantic work. Final hashes are in `graphify-out/scope.json` catalog20261009. No hooks/watchers/Space edits/new issue binding were introduced. No Git commit/PR/merge was performed.

Next operator step: register the real business, attach the existing Coupang account in this project, then run `쿠팡 상품 가져오기`. Real merchant GET/PUT/POST, other marketplace adapters, crop pixel output and automatic category validation remain unverified/pending. Current editor shows local values and per-store published revision; field-level source/remote diffs, URL item restoration and image-failure placeholders remain CAT-UX.

최종 정리: 선택 런타임 11개 파일 해시는 적용본과 일치한다. 두 프로젝트 Hindsight bank에 비민감 구현·회복 계약만 선별 저장하고 document_id/출처를 포함한 재조회로 확인했다. 기존 source-only 노출 상태는 이번 운영 검증으로 갱신하고 실제 판매 계정/크롭 미검증 범위는 유지했다. 사용한 테스트 탭·서버를 종료하고 의존성 후보 복사본과 이관 실험용 DB를 제거했다. selected-runtime/manifest·검증 기록·원본 롤백 백업은 유지한다. staging 적용 스크립트는 당시 설치본 해시에 고정된 일회성 기록이며 재실행 전 현재 버전에서 다시 준비해야 한다.


## Todoist shopping ideas implementation — 2026-10-10

The user requested all open ideas in the Todoist project named `프로젝트 아이디어`.
Three parent headings contain four concrete changes. Completion requires real
implementation and verification, followed by Todoist completion of each child
and its fully completed parent.

- Orders: show buyer name, recipient name and product names in list/detail.
  Preserve unavailable names as missing rather than inventing data. Summaries
  come from all stored orders in the selected account/search/date range, not
  the current page. Show order revenue, total/new/preparing/shipping/delivered
  order counts, with explicit currency and stored-data scope.
- Product registration: bound the shared right-panel representative image to
  a compact preview. Finish real Coupang product import, persist products and
  business/store mappings, show progress/errors/counts in the registration
  view, and verify read-back. Do not publish or modify remote products as part
  of import validation.
- Sourcing: add stage tabs with server-derived counts and filtering over real
  scoped managed products. Keep source evidence and the shared editor. Define
  draft, ready, queued/in-progress, uploaded and attention from stored product,
  listing and latest publication state; do not insert mock products or counts.
- Git: use `master` and `dev`; work on `feature/shopping-ideas` from dev. Existing
  coupled Dovix baseline/profile commits are preserved on this feature until
  the combined integration gates pass. The old develop ref is historical and
  is not treated as dev. Submit a dev-target PR, inspect review/CI, merge within
  the user's authorized dev rollout, then restart and verify the service.
  Master promotion is outside this task.
- Auto Sourcing changes must preserve its existing dirty baseline in an
  isolated checkout. Retain the domain repository/application/adapter split,
  add only necessary additive schema changes, and test actual SQLite.

Verification: focused UI, server boundary, actual SQLite/provider protocol,
source type/build and baseline blockers; live import and browser list/filter/
statistics/editor checks; actual PR/merge/deployed commit receipts. Only verified
requirements are checked in Todoist. Keep secret values, order names and raw
provider responses out of logs and public PR text. Implementation is pending.

Shopping ideas evidence and handoff:
- Order list/detail now display persisted buyer/recipient/product names. The
  service summary covers account/date/search before status and pagination.
  Missing amounts stay unknown and currency totals remain separate.
- Both catalog entry points share the compact product editor. Uploads provide
  selected-store import, progress, completion refresh, and retry.
- Sourcing phase tabs/counts read scoped SQLite product/listing/job state,
  including sourced items after publication; filtering precedes pagination.
- 86 focused UI/baseline tests passed. Final native host/HTTP/SQLite and UI slice:
  39 passed. Workspace typecheck and full build passed. Compatible operating
  shopping pages pass their scoped typecheck and build; the old UI's unrelated
  keyboard-shortcut type differences remain outside that compatibility check.
- The recovered baseline's unknown worker params, unit-test instance collision,
  stale menu assertions, and skill inventory source anchors were reconciled.
  Existing evaluation records were preserved; the inventory completeness check
  passed without installing or accessing a separate evaluation corpus.
- Auto Sourcing PR #6 merged into dev; actual DB-copy import verified 244 named,
  imaged products with store mappings. Read-only order sync verified 49 stored
  orders, 48 with names and one retained record without provider fields.
  Full-scope summaries match across states/pages. Current scoped source count
  is zero; no fabricated sourcing rows were inserted.
- Graphify AST graphs were refreshed and important relationships cross-checked
  with current source. JSON/config files that produced zero nodes are not
  claimed as analyzed code. No semantic extraction or watcher was installed.
- The final regression result, dev merge and operating deployment/readback
  receipt are recorded in this task's PR, with backups and source commit hashes.
