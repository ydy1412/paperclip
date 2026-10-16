# Chrome product capture

Approved 2026-10-16 after merging Gateway #4 and Dovix #37 into dev.

## Contract

User opens one Taobao detail page and clicks the extension. The extension reads
only the current document and already available product data, then sends a bounded
snapshot through Cloudflare Tunnel to Dovix and native Auto Sourcing. No server
page visit, search, login, consent, CAPTCHA or automated navigation is performed.

Initial setup copies a project-bound connection from Shopping settings into the
extension. A separate random bearer permits capture only; hashes are stored in
Dovix, keys are revocable and bound to the issuing user's active company access.
Tokens are never passed to product-page scripts or included in URLs/logs.

Auto Sourcing owns source rows. Capture atomically inserts an original and its
scoped candidate association. Existing originals are preserved on repeat clicks;
no automatic collection, processing, image-generation or publication is started.
Existing scheduled image workers still follow their project settings.
Unknown options/prices/details remain missing, never guessed. Missing fields
are computed from stored originals and shown in the unprocessed detail view.

The MV3 extension has activeTab, scripting and storage; server origin access is
requested only during setup. Capture starts when opening its action popup. A
failed snapshot is retained locally for explicit retry; there are no background
retry/navigation loops. Changing connection clears pending snapshots.

## Verification and rollout

Continuation on 2026-10-16: the user deferred the Dobi authentication investigation
and resumed this feature. Provide the actual extension ZIP from Shopping settings
with short installation steps. Generate it from an explicit source-file allowlist
for both development and production UI builds. Reuse the existing ZIP writer;
include no fixture data, connection keys, test files or browser profiles. Verify an
actual browser download and its archive contents before updating the existing PR.
Fixed public ingress and operating rollout remain distinct from source completion.

Test real SQLite atomic storage, scope, duplicates and original preservation;
HTTP auth/revocation and authoritative scope; extraction on fixture pages;
extension setup/click/retry and unprocessed UI. Distinguish fixture browser,
native HTTP, public tunnel and actual authenticated Taobao evidence.

Both repositories use fresh dev-based feature branches and dev-target PRs.
The prior explorer merge is not an operating deployment. Capture rollout must
use the existing compatible runtime procedure, native service before Dovix.
Cloudflare exposure is limited to capture ingress; no general board API proxy.

Official references checked 2026-10-16:
- https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
- https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/

## Implemented and verified 2026-10-16

- Gateway #4 merged to dev `ef82131628ad89b7432aa0d9c6a40970ebcf8ef8` first.
  Dovix #37 then merged to dev `7bfbddaebbc7b3dcef7458f26da061c767c7d4b8`.
  Neither merge is an operating deployment. Gateway head CI passed; Dovix had no CI check.
- Add the MV3 extension in `extensions/chrome-product-capture`. Setup requests
  only the selected server origin. The popup sends once, retains failed data,
  and explicitly retries the same snapshot. Supplier scripts never receive keys.
- Add capture connection management to Shopping settings and a separate ingress
  before normal actor authentication. 0304 adds only connection metadata/hash rows.
  Current company membership, project, plugin, expiry and revocation are checked.
  Scope comes from the stored connection; a client cannot supply it.
- Reuse the native source repository and candidate association. Keep verified
  `collected.json` evidence for downstream tools. Show missing fields in the
  unprocessed detail. Existing supplier records remain unchanged on duplicate capture.
- 44 focused Dovix cases passed across six suites; native full suite passed
  223 cases with 13 explicit live gates skipped. Seven extraction/transport/Worker
  cases passed. Workspace typecheck and build passed; final UI build/typecheck
  and token gates passed. Full Dovix `test:run` was not repeated: the prior broad
  run remains incomplete, and its general-server manifest records 646 suites /
  53.1 minutes of serial work. Focused success is not a full-suite claim.
- Actual unpacked MV3 Chromium used a separate disposable profile. It sent one
  intercepted product page through an actual Quick Tunnel to Dovix PostgreSQL
  and native HTTP/SQLite. Setup, known price/options, unprocessed readback,
  duplicate, retained-payload retry and revocation passed. The same captured
  image URL loaded as the correct fixture PNG in the list/detail. No uncaught
  page error; exactly one product navigation. The test copy pregrants fixture
  origins; Chrome's native permission prompt and a real Taobao account are unverified.
- Aside u1 verified create/hide/revoke and the actual styled components at
  1440px and in a 390x844 iframe. Both narrow inputs measure 342px, body width
  is 390px, and visible alerts are empty. This is an iframe, not a phone device.
  Fixed the preview's missing CSS plugin and then a real narrow-form width defect.
- Native test setup initially lacked image Python/OCR variables. The final full
  run uses the existing image environment plus the project's compiled Vision OCR.
  Dovix's newly installed Postgres dependency needed its 17 packaged library
  aliases restored from the working dependency. These are ignored test-runtime
  changes. Updated old UI fixtures for image-job reads and page-size controls.
- Graphify: code-only current native graph in `graphify-out/graph.json`;
  scoped host/extension graph in `tmp/chrome-capture/graphify-out/graph.json`.
  Dynamic page state and provider behavior remain source/runtime checks.

Evidence lives under `tmp/chrome-capture/`: `extension-report.json`,
`extension-success.png`, `settings.png`, `narrow.png`, and `source.png`.
The pictures are labelled fixture data. They contain no connection keys.

Reproduce the opt-in preview with
`AUTO_SOURCING_PROJECT_ROOT=../auto-sourcing-chrome-capture node cli/node_modules/tsx/dist/cli.mjs scripts/smoke/sourcing-capture-preview.ts --tunnel`.
Then run `node scripts/smoke/chrome-product-capture.mjs`. If the pinned Playwright
browser is absent, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an already installed
test Chromium. Stop the owned preview afterward; its tunnel and data are disposable.

Paired native implementation PR: https://github.com/ydy1412/auto-sourcing/pull/25.

## Remaining external checks

No named capture Worker/VPC service or operating Dovix/native update is deployed.
Use `deploy/sourcing-capture/README.md` after PR review. Native must precede host;
the older operating core needs the established compatible overlay and backups.
Back up the source database together with its `browser-captures` directory.
Keep existing read-only Personal Brain grants unchanged.

This first version supports Taobao detail pages and known loaded product-state
shapes. Unknown/partial SKU combinations remain missing. The popup warns that
available detail images do not prove the full product description was loaded.
A duplicate does not refresh an existing original. Capturing other marketplaces,
refreshing supplier versions, Web Store publication and automatic browser traversal
are outside this change.

## Installable distribution verified 2026-10-16

Shopping settings now supplies an actual ZIP download and three installation
steps. The Vite integration uses the existing ZIP writer and an explicit list
of ten runtime/README files. It serves the ZIP during development and includes
`downloads/dovix-chrome-product-capture.zip` in the production UI build. There
is no new package dependency, browser installation or user-profile change.

The four focused settings/archive cases passed. Final UI typecheck, build and
token gates passed. The seven existing extension/Worker cases passed again.
The MV3 test now loads the downloaded archive instead of a repository copy,
then downloads it again using the real settings link and verifies its entries.
One synthetic product navigation, actual Quick Tunnel/native storage, image
display, duplicate, exact-payload retry and revocation still pass with no page
errors. Independent Python ZIP/CRC inspection confirms ten entries and exact
source bytes, including the unchanged activeTab-only shipped manifest.

Aside u1 verified the download response (`200`, `application/zip`), all three
instructions, desktop at 1440x900, and the same content in a 390x844 iframe
with body width 390 and no visible alerts. Evidence: `tmp/chrome-capture/` files
`download-aside.json`, `download-desktop.png`, `download-narrow.png`, and the
updated `extension-report.json`. Scoped Graphify now has 107 nodes/148 edges;
the ZIP writer dependency was also checked in source.

The existing authenticated Wrangler installation and Personal Brain VPC service
were checked read-only. No named capture service/Worker, operating rollout or
PR merge was performed. The prior full-suite/native results above are reused
where source is unchanged; this continuation does not claim a new full-workspace
or live Taobao/native-permission test.
