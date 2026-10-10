# Hindsight Knowledge implementation

## Current change contract (2026-10-06)

The mandatory-looking pending review copy below is superseded: confirmation is
optional and unconfirmed knowledge remains usable. The active extension plan is
`2026-10-06-knowledge-library.md`: independent artifact imports, binary analysis,
reference previews, real entity graph and usage counters remain in scope.
The original implementation record below is historical evidence, not completion
of those extensions.

## Requirements and accepted choices

The company Knowledge page displays synthesized knowledge, not a duplicate
artifact gallery. Provide search, project/category/review filters, twenty-item
pagination, split list/detail desktop layout, mobile drill-down, body/evidence/
history tabs, server health and capture settings. Categories are project status,
decisions, conventions, troubleshooting and entity summaries. New synthesis is
visible immediately as pending review. Confirmations apply to a content hash;
changes require review again.

Capture newly completed issues, their completion summaries, issue documents and
bounded UTF-8 text attachments. Unsupported binary attachments remain reference
links. Historical capture is explicit, selected-project only, with preview counts.
Do not capture raw agent output or all comments. Existing agent memory is unchanged.

## Implementation boundary

- Use graphify as a development map, not an application dependency. The initial
  code-only Hindsight plugin graph covers 20 code/config/schema/test files (README
  semantic extraction is excluded). Outputs live under ignored
  `tmp/knowledge-dev/graphify-hindsight/graphify-out/`. Verify inferred edges and
  behavior against source and live tests; graph structure is not runtime proof.
- Generic Korean category queries can return no memories even when the project's
  raw source contains relevant facts. Include at most ten bounded source issue
  titles as quoted retrieval hints, never as instructions or evidence. Require
  raw-memory recall with source chunks before writing. Generation uses world and
  experience facts rather than observation-only shortcuts; consolidation is still
  awaited before refresh. Existing agent banks remain unchanged.
  Hindsight still generates and owns the body/history; no local summary fallback.
- These are retrieval instructions, not a hard provider tool-use guarantee.
  Accept generated content only after checking it against real source facts;
  `content_written` alone is not the five-category acceptance criterion.
- The required full regression gate exposed macOS cache publication failures:
  readonly directories cannot be renamed, including within one parent. Preserve
  immutable descendants and the existing publication lock. Only temporarily
  grant owner-write on the cache revision root, restore its original mode on
  success/failure, and reject writable revision roots during cache reuse. No
  global permissions, runtime authentication or other user directories change.
- Workspace regression fixtures must not invoke an operator's globally installed
  Paperclip CLI or commit their source-instance config into derived checkouts.
  Use a fixture-only unavailable CLI, exclude `.paperclip/` from fixture Git,
  restore PATH after tests and use canonical temporary paths on macOS. Keep real
  provisioning/auth/config validation unchanged; CLI seeding has separate tests.

- Extend the existing `hindsight-integrations/paperclip` package in the user's
  Hindsight fork; retain its plugin key and memory tools. No second provider or
  memory implementation in Paperclip core. Use current Paperclip SDK APIs.
- UI uses authenticated company-scoped plugin data/actions, React Query and
  existing MarkdownBody. Plugin configuration supplies the Hindsight URL and
  secret reference; neither is emitted as a credential to the browser.
- Mobile back navigation remains available during loading and permission/error
  states, not only after a successful detail read. Reference links use existing
  issue document/work-product/attachment anchors to reach the original item.
- A failed authorization/refetch must hide previously cached list/detail/evidence/
  history content in the UI. React Query retaining successful data after a failed
  refetch is not permission to continue rendering that content. Only active detail
  tabs contribute errors; leaving a failed detail restores usable list navigation.
- Translate bridge error codes/domain messages into Korean permission, stale
  review, timeout or connection guidance. Do not display arbitrary native worker
  messages/prompts or generic `Request failed: 502` to the operator.
- Reuse the existing HindsightClient's native HTTP transport for the
  operator-configured self-hosted URL. The SDK documents native fetch as a
  supported plugin transport. Host-managed HTTP rejects loopback; no host
  allowlist option was found. Exposing Hindsight publicly or weakening the global
  SSRF policy is not adopted. Client-supplied URLs are never accepted by knowledge
  data/actions; only the administrator-configured provider URL is used.
- Add plugin-owned knowledge_sources (source snapshots/hash/provenance),
  knowledge_page_bindings (Hindsight IDs/cached body/review hash/history), and
  knowledge_jobs (deduplicated persistent work/retries/operation IDs). All rows
  carry company and project scope. Migration remains additive.
- Separate project banks: `paperclip::COMPANY::knowledge::PROJECT`, with
  `unassigned` for project-less completed work. Bank IDs are derived server-side.
- Register data keys knowledge-list/detail/sources/history/status; register
  actions knowledge-backfill/refresh/review/settings/retry.
- A minute scheduled job reconciles completion/document/attachment changes,
  polls retain and consolidation, and queues five question-defined knowledge
  pages. Ten-minute per-project refresh batching; explicit refresh overrides the
  interval. Stable source document IDs replace changed content. Deletions remove
  their retained documents and explicitly rebuild related pages.
- Do not invent tag scopes: project banks already isolate sources. Review and
  category labels are plugin metadata, not Hindsight retrieval filters.
- Failures never fail source writes. Persistent claims/retries recover after
  restart; three automatic attempts then manual retry. Capture disable retains
  existing knowledge. Access checks reject cross-company/source IDs.
- Sensitive/internal/restricted work is excluded, not summarized into a broader
  audience. Evidence links resolve known source IDs, not arbitrary AI URLs.
- Bind each successfully generated body hash to a source manifest containing
  issue/project IDs and the referenced document/attachment/work-product IDs. Pin
  that manifest when generation starts, and discard/requeue a provider response
  if source hashes change before it completes. Never stamp new provenance onto
  an older cached body. Add these metadata fields through a second additive
  migration; Hindsight remains the only generated-history content store.
- Before listing, searching, reading, reviewing or showing evidence/history,
  verify the pinned source IDs through company-scoped SDK reads. Missing,
  moved, hidden or quarantined sources fail closed, including when automatic
  capture is disabled. Do not trust the mutable source snapshot as proof for an
  older version. Provider history is returned as allowlisted metadata/content;
  versions without verified manifests retain dates but not content. Keep at most
  100 version manifests; older unproven history is redacted rather than guessed.
- Manifest comparison uses normalized typed values, not serialized object-key
  order: PostgreSQL JSONB reorders keys, and unchanged inputs must still publish.
- Extend the existing host `issues.get` read projection to include its already
  supported work-product summaries; the current SDK declares this field but the
  host omits it. Completion-summary documents remain ordinary issue documents.
  No new core memory storage or provider route is introduced.
- Queue refresh requests received during generation must request a subsequent
  pass, rather than silently disappearing. Manual refresh bypasses batching.
  Review writes are atomic against the displayed hash and must not be overwritten
  by a concurrent background generation write. Invalid UTF-8 attachments remain
  unanalyzed references rather than failing the entire source capture.
- Source-read failures also become persisted capture jobs with bounded retries;
  they must not disappear as a reconciliation log entry. Source work has priority
  over refresh jobs so a waiting refresh cannot starve its own prerequisites.
- If an issue moves projects while source assembly is being retried, derive its
  current project again, delete retained data from the previous bank, and enqueue
  capture in the new bank. A retry must not retain into its stale queued scope.
- Preserve the provider's operation failure cause. The third automatic failure
  must not launch another native retry after the plugin stops; manual retry is
  required to resume, and terminal errors must not say "retrying".
- Live quality inspection found observation consolidation dropped the database
  selection rationale while the underlying world fact retained it. Knowledge
  triggers must include world/experience/observation and source chunks, rather
  than accepting the provider's observation-only default. The source facts remain
  authoritative; unsupported model citations are not converted into source links.
- Category questions explicitly exclude unrelated facts (for example an assignee
  or remaining task is not a reusable convention). Use concise Korean sections,
  not generation-process attestations, invented benefits or unsupported "latest"
  and timestamp claims. Update both source_query and trigger on existing models;
  otherwise provider pages keep obsolete instructions. Limit page output to 900
  tokens while keeping the underlying recall scope unchanged.
- Require the first response to call the provided `search_observations` tool,
  before writing facts/documents. The local Ollama endpoint drops forced tool
  choice, and the actual troubleshooting question otherwise produced an invented
  structured answer without any retrieval. Keep the provider's no-evidence guard;
  never turn that text into a successful synthesis.

## Validation contract

Unit/integration: isolation, source assembly, deterministic hashes, duplicate
events, original updates/deletions, crash recovery, retries, review invalidation,
search/pagination and history. Live acceptance: a separate test project completes
work, retains memory, generates pages, renders in Paperclip, then updates and
rebuilds. Aside-only browser checks at 390/768/1440px. No mock result substitutes
for live generation. Backup production config/DB/plugin before rollout; verify
rollback and preserve existing service/agents. No binary extraction/OCR in v1.

## Execution checklist

- [x] Inspect existing page, plugin/SDK and Hindsight endpoints.
- [x] Lock selected-project backfill and automatic visibility/manual review.
- [x] Record implementation contract before production changes.
- [x] Implement plugin migrations, source assembly and persistent queue.
- [x] Implement Hindsight generation, deletion, refresh and evidence linkage (live acceptance below remains open).
- [x] Implement authenticated data/actions and review metadata.
- [x] Implement list/detail/filter/search/settings/review UI.
- [x] Run applicable feature unit/integration/typecheck/build checks; record exact results.
- [x] Verify real generation/update and Aside desktop/mobile workflows in development.
- [x] Back up, apply, verify rollback and production behavior.
- [x] Review feature diff and reconcile documentation with delivered behavior.

## Evidence and remaining work

### Current checklist status after operational rollback verification

- Final production navigation verification on 2026-10-05: Aside account u1,
  authenticated as master in dobby's company, renders Work > Knowledge and the
  actual /DOB/knowledge screen. Projects > Knowledge clicks preserve /DOB;
  the screen shows Hindsight connected, search, project/category/review filters
  and the valid empty state. No production backfill was initiated. The earlier
  u0 authentication blocker is historical, not a current release blocker.
- Production Sidebar and company-route regression checks pass alongside the
  Knowledge screen/API checks: 61 tests in four files on the exact baseline;
  UI typecheck/build pass. Main sidebar/company-route tests pass 56 tests.
  Updated compiled UI is applied to the existing production instance; no backend,
  account, company or agent changes were made for this follow-up. Both classic and
  production navigation variants now include Knowledge. The final browser gate
  and execution checklist are complete; earlier incomplete evidence is retained
  below only as chronology, not current status.
- Operator follow-up: Aside account u1 has the authenticated administrator
  production tab at 3100. The prior u0 login blocker does not apply to that tab.
  Its active production layout uses Sidebar.production, which omitted Knowledge
  while the classic Sidebar contained it. Add the same Work navigation link to
  both layouts and cover the production variant in the existing sidebar tests;
  rebuild/deploy and verify by clicking the actual signed-in menu.
  Actual clicking exposed another missing registration: company-routes did not
  classify /knowledge as a board route and treated KNOWLEDGE as a company prefix.
  Register that root and test prefix application/relative paths/query preservation.
- Final objective review found the category label missing from list items;
  display the category separately from title/summary/project/date/review and
  assert that label in the existing Knowledge screen test. This is an original
  checklist requirement, not an additional output-polishing gate.
- The category-label change passed `pnpm exec vitest run
  ui/src/pages/Knowledge.test.tsx ui/src/api/knowledge.test.ts` (17 tests),
  `pnpm --filter @paperclipai/ui typecheck` and
  `pnpm --filter @paperclipai/ui build` in the exact-production-baseline checkout.
  The built UI was copied to the existing production server; no backend/config
  or account changes were required. Existing Vite/CSS/chunk-size warnings remain
  outside this feature scope. The production browser sign-in gate stays open.
  The main development UI build also passed. Aside confirmed the five list-item
  category labels on the live development screen after rebuilding. The deployed
  index hash matches the compatible build and production health returns HTTP 200.
- Final feature review checked the Knowledge UI/bridge, company guard before
  work-product projection, source assembly and provenance, persistent queue,
  native synthesis/history ownership and company-scoped lifecycle changes.
  No new core memory system or parallel application root was introduced. The
  temporary exact-baseline checkout is a deployment compatibility checkout,
  not a second documentation source. Its plan is synchronized from this file.
  Unrelated original-checkout changes are preserved. Ancillary earlier cache/CLI
  fixture changes are not reclassified as Knowledge feature requirements.
- Stop extra prose/prompt-polishing tests as requested. Only the original feature
  checklist remains a completion gate; unrelated CLI/adapter repairs are not
  continued.
- Performed an actual production rollback through the normal instance-admin
  plugin lifecycle: soft-uninstalled 0.5.0 without purge and installed archived
  0.4.0 with SDK 2026.1001.0. Restored archived UI/host files and gracefully
  restarted the existing LaunchAgent without rewriting its tool PATH. The old
  plugin was ready, authenticated API returned HTTP 200, and UI index/host
  JavaScript hashes matched the preapply archive.
- Reapplied the exact-baseline Knowledge UI/host patch and packaged 0.5.0
  company-scope release, then restarted the same service. Plugin ID
  2f8fc834-76cb-4faa-8f06-95cf0d16bb60 is unchanged and status is ready.
  Authenticated knowledge-status and knowledge-list return HTTP 200;
  connected=true, enabled=true, sourceCount=0, total=0. No historical import
  or synthetic production issue was created.
- After reapplication, all original identity hashes match: companies 2,
  agents 4, users 2, plugin configurations 1. The instance configuration hash
  matches its original backup. Active/queued heartbeats were absent at each
  reload. Additive plugin tables were retained; no production database restore
  or account/security reset was needed. The earlier isolated SQL restore remains
  the database-backup restoration evidence.
- Administrator browser verification remains open. Aside session
  2026-10-05_8vatOv1eRTrn73oX checked existing tabs, saved credentials/connected
  password managers and supported SSO. The target requires email/password;
  its existing tab is signed out, no matching credential or connected external
  manager exists, and no SSO is offered. No password reset, cookie/token
  injection, authentication bypass or browser-account switch was performed.
  The 5174 shell does not prove authenticated production Knowledge rendering.
- Backup, production application, preservation and live rollback/reapplication
  are verified. Authenticated production browser rendering still requires an
  existing administrator sign-in. Do not mark the whole goal complete.

### Production application evidence at 09:40 KST on 2026-10-05

- Exact-baseline compiled Knowledge UI and the host work-product projection are
  installed in the existing 2026.1001.0 server distribution. Core commit remains
  8f8a0ab7; this is a local patch, not a full upstream/core-schema upgrade.
- Production plugin 2f8fc834-76cb-4faa-8f06-95cf0d16bb60 is ready at 0.5.0 from
  the packaged company-scope release under ~/.paperclip/plugins/releases/.
  The normal instance-admin soft-uninstall/reinstall flow preserved its ID and
  configuration; purge was not used. The required SDK dependency is pinned to
  2026.1001.0 in that release. Initial activation failed on an unconfigured-company
  config read; the corrected plugin registers without that eager read and skips
  denied/unconfigured companies during reconciliation. Host authorization remains
  unchanged. All 114 plugin tests, including 15 PostgreSQL tests, and plugin
  typecheck/build pass after this correction.
- Latest preapply DB backup: knowledge-preapply-20261005-093029.sql.gz,
  413146 bytes. UI/host archive SHA256 is
  191c6f17cfbad398e4cc2d08dc8d3e2d150d31e72ff38ea508588bdddccaa02b.
  Its contents extract successfully into owned file-restore-check/. Earlier
  isolated SQL restore matched company/agent/user/config counts. These checks
  prove backup restoreability, not a completed live operational rollback.
- Postapply identity/config hashes match the preapply snapshot: companies 2,
  agents 4, users 2, plugin config 1. The instance config file exactly matches
  the original backup. Existing authenticated CLI credentials still work.
  Production Knowledge status/list return authenticated HTTP 200; Hindsight is
  connected, capture enabled, source count zero. No historical production import
  was silently started. Previously completed work requires explicit selection.
- A serious validation side effect was detected before preapply: the real service
  LaunchAgent had disappeared and 3100/54329 were down after the broader CLI test
  run. The cause is consistent with fixture uninstall paths using a real service
  manager; mocking homedir was not a sufficient isolation boundary. Those two
  paths now inject a disabled test service-manager dependency explicitly. No more
  unrelated broad tests are run. The original service was re-registered using the
  official CLI and original instance config; accounts/data remain present.
  Restore the explicit tool PATH in its LaunchAgent after CLI definition rewrites.
  Launchctl bootstrap initially raced the departing process, then succeeded once
  the old process was authoritatively gone. Current PID 27694 is active/healthy;
  its PATH includes /opt/homebrew/bin and ~/.local/bin. There were no running or
  queued heartbeats when reloading that definition. Do not report zero side effects.
- The original restart with --expected-version timed out because the protected
  health response does not publish a version field, despite HTTP 200 and the
  expected core commit. Do not equate that CLI outcome with a failed server.
- Actual development status body changed from hash 73bd9dd7... to 32f25234...,
  now includes the changed keyboard-navigation remaining task and review=pending.
  Aside renders the updated body and enabled contents-confirmation button; its
  prior verified confirmed state is no longer shown. Five generated pages are
  ready. This completes live generation/update/review-invalidation evidence.
- Aside production login attempt stopped: no matching Paperclip credential in
  the selected account's Vault, no login submitted, no account/security changes.
  Screenshot: /Users/ydy1412/.aside/u/0/sessions/2026-10-05_iYEjRoVte2ZSXpDg/artifacts/paperclip-knowledge-login-blocked.png.
  Production browser rendering after login and live operational rollback remain
  unverified. Preserve this distinction from authenticated API and development
  browser success. Feature is applied; the complete goal is not yet achieved.

### Operator scope clarification and historical validation notes

Production activation exposed a real multi-company boundary: setup enumerated
all companies and attempted config.get for an unconfigured company, which the
host correctly denied. Register handlers without eager cross-company config
reads; configured-company state is initialized by onConfigChanged or a scoped
action. Reconciliation skips denied/unconfigured company settings and continues
configured companies. Do not relax host authorization. Agent memory handlers
must pass event/tool company IDs explicitly when reading their settings.

The operator requires the original execution checklist only. Do not add polished
wording, category-perfect prose, boilerplate elimination or repeated prompt
tuning as separate release gates. Validate actual generation, source updates,
review invalidation, provenance and access boundaries against the original
contract. Retain the original no-unsupported-facts requirement, without turning
stylistic preferences into blockers. Stop unrelated repository-wide CLI/adapter
repair work. Record broad-suite failures honestly; use applicable feature tests,
build/typecheck and live checks for feature validation. Production backup,
application, preserved auth/company/agents and rollback verification remain
mandatory. Their current completion status is recorded above.

The CLI fixture isolation changes passed all 502 CLI tests with canonical TMPDIR;
the latest doctor cleanup test also passed. Plugin tests pass 112, including 15
PostgreSQL cases, and plugin typecheck/build pass. Broader workspace tests reached
adapter-utils and failed two unrelated checks: installed Claude 2.1.81 below the
suite prerequisite 2.1.207, and a Gemini resume case that passes in isolation.
An isolated 2.1.207 test CLI was installed under ignored tmp before clarification;
no global CLI, operator credentials or production settings were changed. No
further unrelated suite repair is required by this checklist.

Review of the real synthetic status page changed pending to confirmed, recording
the displayed hash and a second review-log entry; Aside shows the disabled
confirmed button. The synthetic issue then changed its remaining task via the
real API (HTTP 200). Retain operation 27fc7aca-64a3-442d-ae98-473464612312 completed;
the prior in-flight refresh bc1c9bf3-1eba-4c3b-9e60-35dbd3a93fd4 also completed but
was discarded because its pinned source changed. Refresh initially remained
pending at index zero with no operation ID. The later generation/update and
review-invalidation evidence is recorded above.

Implementation is in progress. Main source worktree is
`/tmp/paperclip-knowledge-current`, branch `codex/knowledge-hindsight`. Plugin is
`/Users/ydy1412/projects/hindsight/hindsight-integrations/paperclip`. Production
Paperclip runs on 3100 and must not be replaced before isolated validation.

### Graphify development follow-up on 2026-10-05

- User selected Knowledge screen/API/server bridge only, not all 1858 UI files.
  Graphify's broad scan skipped `motion-tokens.css` as sensitive; this is a
  detector classification, not verified evidence of a secret. Broad scan caches
  are removed; feature graphs and the local builder remain in ignored `tmp/`.
- Code-only plugin graph: 20 files, 200 nodes, 385 edges, 12 communities. Scoped
  Paperclip graph: nine files, 115 nodes, 166 edges, 13 communities. Reports/HTML/
  JSON are in `tmp/knowledge-dev/graphify-{hindsight,paperclip}/graphify-out/`.
  No application dependency, new hook or credential/API-key requirement added.
  Reports identify the correct repository commit plus working-tree file hashes.
- Raw AST diagnostics expose limitations that post-build JSON hides: plugin has
  22 dangling-endpoint edges and one same-endpoint relationship collapsed;
  Paperclip has 276 dangling-endpoint edges from unindexed dependencies. Two
  plugin relationships are inferred. No import cycle was detected within scope;
  this does not prove the whole repositories are cycle-free. Reports retain all
  warnings. Graphify's benchmark printed 3.6x for a sample query, but uses a
  fallback corpus estimate, not measured development time or actual task savings.
- Traversed pipeline/source/refresh/manifest/access/history and Knowledge bridge/
  error paths. Live recall found no results for the generic category query, but
  six facts plus the complete source chunk for the actual issue title. Generation
  questions now quote up to ten deduplicated 120-character titles from the same
  company/project, and request raw recall before composing. This remains a
  provider instruction rather than enforced tool sequencing. New live refresh
  operation `6e9b02bd-21b2-4109-89bc-d0f6cff2a25a` completed without provider
  retry, but its status page still omitted the known remaining task. Five-category
  content acceptance remains open; do not equate content_written with quality.
- `tests/knowledge.spec.ts` adds bounded retrieval-hint and raw-recall instruction
  assertions. Plugin `npm test` passes 107 tests, including 14 isolated PostgreSQL
  cases; `npm run typecheck` and `npm run build` pass. Latest UI typecheck passes.
  Focused `Knowledge.test.tsx`, `api/knowledge.test.ts` and host-access test run
  passes 23 tests, recorded in `tmp/knowledge-dev/knowledge-focused-final.log`.
- Required `pnpm test:run` finished with exit 1: 744 server files passed, three
  failed, five skipped; 15062 tests passed, 18 failed, 89 skipped. Its runner
  stopped in the general-server phase, so later workspace/serialized phases
  cannot be claimed complete. A sequential isolated rerun with PAPERCLIP_HOME/
  INSTANCE_ID unset still failed the three suites (238 passed, 20 failed): readonly
  runtime-cache directory rename EACCES, downstream company-skill availability,
  workspace fixture/config/path failures. Their source/test/provision files match
  HEAD, but a clean-baseline test run has not yet proved all failures pre-existing.
  Logs: `full-test.log`, `full-test-failures-isolated.log`. Full gate stays open.
- Actual revision-2 source recapture changed the status body hash while retaining
  its previous reviewed_hash; SQL comparison is false, proving review invalidation.
  Browser confirmation of this latest content-change state, artifact link checks,
  live outage/deletion/restart/retry, full regression gates and production rollout/
  rollback remain required. Production Paperclip has not been updated.

### Verified follow-up at 07:58 KST on 2026-10-05

- Fixed macOS publication of sealed runtime-skill cache roots: temporarily grant
  owner write permission only to the root being renamed, restore its mode after
  success or failure, and reject writable cache roots during reuse. The cache and
  company-skill suites pass all 95 tests after the previously observed failures.
- Workspace tests now canonicalize the temporary-directory alias and isolate the
  fixture from the operator's installed Paperclip CLI. Production provisioning
  code and its authentication behavior are unchanged. All 164 workspace tests
  pass. Required full `pnpm test:run` is still running in
  `tmp/knowledge-dev/full-test-after-fixes.log`; it is not yet a passed gate.
- Latest complete `pnpm -r typecheck` and `pnpm build` both exit successfully;
  logs are `typecheck-latest.log` and `build-after-fixes.log` in the same directory.
- Native generation now requests world/experience facts and raw source chunks,
  rather than exposing an observation-only shortcut. The instruction requires
  raw recall first. This does not replace native evidence checks or guarantee
  output quality. The refreshed plugin graph still has 200 nodes/385 edges and
  now records hashes of these latest working-tree files.
- Raw-first live output recovered the remaining mobile task, but conventions
  still misclassified a one-off database choice as preference and appended
  unrelated facts. Strengthen category-only output instructions, omit unrelated
  headings, and reserve the single insufficient-data message for a wholly empty
  category. Native Hindsight remains the body owner; no local synthetic body is
  substituted. Acceptance is still based on actual output, not prompt tests.
- Public page/status/job failure fields must not expose arbitrary provider error
  bodies or prompts. Keep raw diagnostics in persisted jobs for operation while
  projecting fixed Korean guidance to the Knowledge bridge.
- Native `MentalModelTrigger.exclude_mental_models=true` is supported by the
  checked local Hindsight API. Exclude derived models during synthesis so old
  summaries cannot become their own evidence. A native empty refresh preserves
  existing content; therefore deleting the last source must delete only the
  project's plugin-bound native page/model nodes and their bindings, rather
  than republish old content with an empty manifest. Treat an empty manifest as
  unreadable for nonempty cached content. Other bank pages are not removed.
- Real plugin disable/enable and an unreachable configured Hindsight endpoint
  both permit original issue writes. The endpoint was restored afterward;
  retained source operation `8e801a10-49d5-4857-9a33-74c8918756a5` completed
  without extraction errors. No shared Hindsight service or production host
  was stopped for this test.
- The full development host was stopped gracefully and restarted with the same
  isolated home/database. Health reached ready. The refresh job ID, index 1,
  rerun flag and pinned source manifest survived unchanged, then continued with
  provider operation `7aa85ce1-fc08-4454-8a5c-7b40b7824126`.
- Deleted only the synthetic outage issue KNO-2 through the real issue API.
  Its cleanup job reached done, source count returned from two to one, and the
  native retained document GET returned 404. Final regenerated-page acceptance
  after this source change remains open.
- Aside clicked the actual artifact provenance link. It opened KNO-1 with
  `#work-product-87cc8de6-8304-4526-a3b9-a6e4d9a98894`, displaying the original
  8888-port/health-check result. This verifies navigation, not five-category
  generation quality. Production installation and rollback remain unverified.
- Installed server build metadata identifies production commit
  `8f8a0ab7effbd6a0584107d8038736c134ee5047`, available in local Git. Its server
  distribution contains separate compiled modules and `ui-dist/`, not a single
  bundle. Validate a narrow Knowledge/navigation/host-access patch against this
  exact baseline before application; do not replace it with the full newer
  checkout or silently migrate unrelated core schemas. A temporary baseline
  checkout is a deployment compatibility test, not a second canonical source.

### Verified follow-up at 08:30 KST on 2026-10-05

- Latest plugin suite passes 111 tests, including 15 real PostgreSQL cases.
  Last-source cleanup failed before the implementation and passes afterward.
  Empty source manifests cannot authorize preserved nonempty content; raw
  provider failures are not exposed by page/status/job projections. Typecheck
  and build pass. Logs: `last-source-before-fix.log`, `last-source-final.log`.
- The production-compatible checkout at the exact installed commit passes a
  complete build and recursive typecheck, plus 50 focused UI/API/sidebar/host
  tests. Both checkouts pass `pnpm check:token-gates`. Latest main UI build and
  focused 23-test run pass after moving fixed layout dimensions into design
  tokens. The host test now disposes its service fixture.
- Aside verifies the token-based layout at native 1440px (scroll width 1440,
  detail grid 320px/817px) and framed 390/768px. Body, provenance, history, list
  return and search empty state work without horizontal overflow. Framed checks
  are not native mobile device emulation. Original browser tabs are preserved.
- Live retry fixture in a separate development company reached attempts 1, 2,
  then failed at 3. Restoring the endpoint and explicit `knowledge-retry` reset
  attempts to 0 and completed retain operation
  `73ecc2a9-14dd-4a94-b89d-60bc2296f26a`. Source deletion reached done and the
  retained document returned 404. Final last-source cleanup removed its bound
  page/model: model GET 404, native tree roots empty, all three jobs done. Only
  this generated company and bank were then deleted. Log: `retry-live.log`.
- Disabling main-company capture and triggering two real scheduler runs leaves
  cached body hashes and pending job states/payloads identical. Capture was
  restored in finally. Log: `capture-disabled-live.log`.
- Repeated local-plugin rebuild exposed a stale/crashed worker registration.
  File-watch reload and disable/enable did not recover it. Graceful development
  host restart recovered ready/healthy and persistent jobs without restarting
  Hindsight. Use immutable packaged code for production, not the watched source
  checkout. No general worker-manager refactor is included in this feature.
- Latest scoped plugin graph: 201 nodes, 388 edges, 12 communities; Paperclip
  remains 115/166/13. Source hashes are refreshed, generated extraction caches
  removed, and audit warnings retained. No app dependency or hook is installed.
- Full `pnpm test:run` remains live in `full-test-after-fixes.log`. The final
  native pass now excludes all derived mental models as evidence; operation
  `8891bd2d-21e2-4ba6-878b-677f1ab3b0bd` started it. Five-category factual quality,
  final review/change browser check, and production apply/rollback remain open.
  Production UI/host files are also archived in `paperclip-ui-host-before.tgz`;
  backup directory is mode 700 and files mode 600. Production is not modified.

### Scoped analysis and final-pass observation on 2026-10-05

- Follow-up CLI fixture plan: isolate both environment HOME/PAPERCLIP_HOME and
  os.homedir() in doctor and managed-install tests. Keep repair checks and all
  uninstall safeguards intact. Restore mocks/environment and remove only owned
  temporary folders after each test; do not inspect or mutate operator services.
- Native quality follow-up: end each category instruction with a concise output
  contract (status sections, recurring-rule bullets, or symptom/cause/fix/prevention
  labels). Restrict troubleshooting to incident facts and rules to recurring
  requirements. Do not truncate or rewrite native bodies locally. Prompt contract
  tests are not a substitute for checking regenerated native content.

- Scope follows the operator's explicit selection: Knowledge screen, API and
  server connection boundary, plus the corresponding Hindsight plugin. No full
  Paperclip UI graph or new application graph dependency is required.
- The full regression command has terminated with exit 1. General server suites
  passed 15,081 tests (89 skipped); UI passed 7,335 tests. The CLI phase passed
  498 tests and failed four: the doctor repair case and three managed uninstall
  cases. Uninstall failures observe the operator's real LaunchAgent despite
  fixture HOME overrides. This is not a reason to remove that service or weaken
  uninstall safety. The doctor cause requires further isolation. Later phases
  were not reached; the full gate has not passed.
- The final native generation poller terminated successfully: all five category
  models returned HTTP 200 and their content exactly matches the plugin cache;
  all five bindings are ready and require review. The provider remains the body
  owner, with no fabricated local fallback. Decisions correctly retain the
  PostgreSQL transaction/compatibility rationale and entities correctly identify
  PostgreSQL as technology and Minsu as a person/tester.
- Quality acceptance remains open. Conventions mixes the one-off database
  selection and connection repair into recurring rules; troubleshooting adds
  unrelated project facts and an unsupported latest-state timestamp. Status
  repeats the connection fix, and several bodies add self-certifying boilerplate.
  These native outputs are not accepted merely because generation completed.
  Refine category grounding and verify actual outputs before production rollout.
- The first inspection incorrectly used knowledge page IDs on the mental-model
  endpoint and returned 404. Repeating with the stored model_id returned all
  five models successfully; no data deletion or provider failure was inferred
  from the wrong endpoint.
- Final live review/change verification, remaining full regression phases and
  production apply/rollback are still incomplete. Production remains unchanged.

### Verified follow-up at 07:21 KST on 2026-10-05

- Plugin suite passes 106 tests, including 14 real PostgreSQL cases. The added
  project-move recovery case proves delayed source assembly changes banks and
  queues cleanup of the previous retained document. Source questions now require
  a real first `search_observations` call, retaining the native no-evidence guard.
- Focused UI/API/host suite passes 23 tests. Two new cached-content revocation
  regressions failed before the fix and pass after it. Structured bridge errors
  now map to Korean permission/stale-review/timeout/connection guidance, without
  displaying arbitrary worker content. The final added test needed an explicit
  unknown-to-Error narrowing; latest typecheck is being rerun.
- Full `pnpm -r typecheck` passed before these follow-up edits. Full `pnpm build`
  completed successfully; latest UI build also completed. Required `pnpm test:run`
  remains live, with output in `tmp/knowledge-dev/full-test.log`; do not count it
  as passed until its process reports completion. No browser automation outside
  Aside was used.
- Aside read the real 326-character status page and saved its exact hash review.
  Clicking its completion-document link opened the correct revision in the issue
  side panel. Selected-project import preview showed one completed issue; actual
  import displayed progress 1/1 and ongoing synthesis. Subsequent source edits
  correctly return import capture progress to 0/1 until recapture completes.
- Real long Korean content (about 1900 displayed characters) has no horizontal
  overflow in same-origin 390px and 768px iframe viewports. Back navigation,
  search empty state, project/review filtering, and history were exercised. These
  are framed responsive checks, not mobile-device emulation. Native 1440px
  screenshot and width checks are recorded above. Some one-shot probe assertions
  failed due to whitespace-specific selectors and output-size limits; successful
  interactions/measurements are recorded individually, not as complete probe runs.
- With capture disabled, Aside verified the real source's `hiddenAt`, refreshed
  the selected page and observed an empty article instead of its cached body.
  The source visibility and capture setting were restored in finally. The server
  returned a generic 502 bridge envelope; this prompted the friendly-message fix.
- Completion document `completion-result` was changed to revision 2 with the
  synthetic project's explicit backup-before-deploy rule. Same document ID was
  retained by provider operation `c1c120ac-331a-44ec-add9-6955d1c94922`, completed
  with zero extraction errors. Full regenerated five-category quality and review
  invalidation after this actual content change remain open.
- Tool-choice diagnosis used the actual roughly 10089-character Hindsight system
  prompt and failing category question: unmodified OpenAI-compatible request
  produced text without tools; explicit Korean retrieval-first instructions
  produced a real search call in 2.8s. Native Ollama API and alternate installed
  Qwen2.5 also returned real calls (2.2s/6.1s). Adopted prompt-only correction;
  neither native guard weakening nor a global endpoint/model replacement.
- Development hot reload overlapped a manual lifecycle reload and left the worker
  in a terminal error state. After build/watcher activity settled, the official
  enable action restored healthy=true. Production was unaffected; future
  production installs should use a built immutable package, not this watched path.
- Official production backup saved
  `tmp/knowledge-dev/production-backup/knowledge-before-20261005-070647.sql.gz`
  (412990 bytes), with gzip integrity checked and permissions restricted to 600.
  Configuration and installed 0.4.0 plugin files were also backed up. SQL restored
  successfully via psql ON_ERROR_STOP into temporary `knowledge_restore_20261005`
  on isolated port 54330: production/restored counts both company=2, agent=4,
  user=2, plugin_config=1, plugin=1. Only the temporary restore database was then
  dropped. This proves backup restoration, not production apply/rollback.

### Verified on 2026-10-05

- Plugin tests: `KNOWLEDGE_TEST_DB_URL=postgres://paperclip:paperclip@127.0.0.1:54330/paperclip npm test`
  passed 92 tests, including 8 PostgreSQL integration tests. These create and
  remove a unique test schema only in the isolated development database.
  `tests/knowledge.spec.ts` covers sources, isolation, cached search, selected
  imports and review actions. `tests/knowledge-database.spec.ts` covers stable
  IDs, dedupe, hash review invalidation, concurrent review retention, persistent
  claims, bounded retries, source updates/deletions and selected-project import.
- Plugin `npm run typecheck` and `npm run build` passed. UI
  `pnpm --filter @paperclipai/ui typecheck` and `pnpm --filter @paperclipai/ui build`
  passed. Existing CSS highlight/dynamic import/chunk warnings remain unrelated.
- `pnpm exec vitest run ui/src/pages/Knowledge.test.tsx server/src/__tests__/plugin-access-authorization-host-services.test.ts`
  passed 12 tests. UI covers selection (including a real URL-update regression),
  exact hash confirmation, disabled plugin, retry and provider history parsing.
  Host test proves work-product summaries and cross-company denial.
- Isolated runtime is `http://127.0.0.1:3102/KNO/knowledge`, company
  `5b13a29a-6b90-4ac8-b005-c97c972575db`, project
  `c27a7d4a-ffbb-445d-934e-9184a1fae643`. A real task completion retained and
  consolidated facts. Status and decision pages were generated and read through
  the plugin bridge. Other categories/full refreshed pass are not yet accepted.
- A completion document and a work-product summary were added to the synthetic
  test issue KNO-1. Their real IDs and document deep link appear in knowledge-sources.
  The source uses a stable document ID and changed hashes enqueue recapture.
- Development server restart at `2026-10-04T21:11:50.044Z` retained the source,
  refresh operation `3d6225fd-89c0-4c07-878f-662ea1b344d4`, payload/index/rerun
  and plugin configuration. Production service/settings were not changed.
- Aside measured top-level 1440px without overflow. Its `setViewportSize` is
  unavailable; no alternate browser was used. Aside same-origin iframe documents
  measured actual 390/768px viewport widths and no horizontal overflow. 390px
  body and 768px body/evidence/history/back were inspected. These are framed
  responsive checks, not mobile-device emulation. Screenshots were saved in
  Aside's authorized session roots (the requested repository artifact path was
  denied; no permissions were widened):
  `/Users/ydy1412/.aside/u/0/sessions/2026-10-05_WO5CSDE3SQs5NCGw/artifacts/knowledge-desktop.png`,
  `/Users/ydy1412/.aside/u/0/sessions/2026-10-05_xUX0IEqbcHMgaaUH/artifacts/knowledge-frame-390.png`,
  `/Users/ydy1412/.aside/u/0/sessions/2026-10-05_5ivjW1sGJyXUWzXP/artifacts/knowledge-frame-768-history.png`.
- Gemma extracted facts but intermittently skipped required memory tool calls.
  Existing Qwen2.5 also failed that probe. Qwen3:4b was installed locally and
  returned a real tool call; it is used only for reflect/page refresh. No cloud
  secret or public listener was introduced. A real decision page completed with
  Qwen3, but the observation-only provider default omitted a rationale present
  in the underlying world fact; new triggers include all source fact kinds.

### Remaining acceptance work

- Observe all five categories and the full refreshed pass using current source
  facts; evaluate Korean grounding, rationale and troubleshooting completeness.
- Verify live review -> source update -> regeneration -> pending review, live
  source deletion/cleanup, provider outage and disabled capture. Mock/SQL checks
  are not substitutes for these live gates.
- Extend live revocation checks beyond the verified hidden-issue case to changed
  document/artifact trust and historical versions after successful regeneration.
  Read-time guards and version manifests now pass focused regression tests.
- Complete framed 390px back/filter checks and long Korean stress checks,
  verify document/artifact deep links, settings/import progress and errors.
- Run the required broader project checks, review maintainability/final diff,
  reconcile all documentation, and perform production backup/apply/rollback.

### Authorization hardening evidence (2026-10-05 follow-up)

- Added `002_knowledge_provenance.sql`, without changing the installed first
  migration. Source/version manifests store IDs and hashes only; source snapshots
  may be updated/deleted without losing authorization evidence for older bodies.
- Plugin suite passed 104 tests, including 13 real PostgreSQL tests on the isolated
  54330 database. Coverage includes revocation at all read/review paths, historical
  content redaction, binary reference access, artifact quarantine, source metadata
  persistence, refusing a response generated from changed in-flight inputs, and
  stopping native retry dispatch after the third automatic failure. Missing
  manifests are SQL NULL rather than JSON null; either form is denied at read time.
  The additional unchanged-input generation test reproduces a JSONB round trip:
  comparing serialized objects previously rejected every response because JSONB
  reordered keys. The pipeline now compares normalized typed manifest values.
  This regression proves both publishing unchanged inputs and rejecting changed
  ones; earlier change-only tests did not cover the successful publication path.
- Plugin typecheck/build and UI typecheck/build passed. The focused UI/host suite passed
  13 tests including the added redacted-history UI case.
- Disabled/enabled the isolated development plugin through its lifecycle API.
  The host applied the second migration and loaded the new worker successfully.
  Existing bodies without provenance were denied rather than retroactively given
  unverifiable source mappings.
- Live authorization test used a clearly synthetic cached-body fixture, not an
  LLM-generation substitute. With capture disabled, hiding the real KNO-1 source
  immediately blocked detail/evidence/history (bridge WORKER_ERROR, HTTP 502),
  removed search matches/counts and rejected review. Unhiding restored access.
  The fixture was removed and original source/capture settings restored. This
  proves the native host/SDK read boundary, not full generation acceptance.
- Provider operation `3d6225fd-89c0-4c07-878f-662ea1b344d4` is authoritatively
  failed: 300-second reflect wall-clock timeout at Ollama tool-call/backoff stage.
  No restart was performed merely due to an observation timeout. Full generation
  and production rollout remain incomplete.
- Local template closing and `/no_think` probes failed, so the unused prototype
  model/file were removed. Official `qwen3:4b-instruct` was installed; a separate
  8192-context alias `paperclip-qwen3-instruct` returned a real memory tool call in
  7.1 seconds, 27 tokens, without a reasoning/content preamble. Compose now uses
  this alias for reflect/refresh only. The container was recreated for this actual
  configuration change, after checking previous operations were terminal. Its
  volume and extraction/embedding settings were preserved. Native full generation
  was requested again through the development plugin actions; results are pending.
- Re-polled the specific operation after the change: it progressed through tool
  retrieval/native reflect and completed at `2026-10-04T21:40:14.455759+00:00`.
  Its old observation-only trigger returned a long Korean "자료 부족" body and no
  based-on facts. This is not accepted as the full-source convention page. Because
  that legacy operation had no pinned input manifest, the plugin refused to cache
  the response and reset its operation ID for a fresh request using the current
  trigger/manifest. The persistent refresh still has index 2, force/rerun true.
  The retry used the existing operation ID, not a fabricated duplicate operation.
- Fresh convention operation `97dddd36-370d-4b2c-90b2-9f7967e2e899` completed
  using the current full-source trigger and a pinned issue/document/artifact
  manifest. Native content now includes PostgreSQL's transaction/compatibility
  rationale, pre-deploy typecheck/tests and the 8888/health-check fix. Provider
  based-on metadata contains 3 world and 2 experience facts. Mobile QA was placed
  under user preference rather than remaining tasks; category-specific prompt
  precision still needs review. Other categories/full rerun remain required.
- Rebuilt/reloaded the development worker after the manifest-comparison fix.
  Refresh operation `dbd53c39-a249-4f9c-8d3d-a17b844648a9` remains the persisted
  in-flight convention operation with its pinned source hashes. The final bridge
  read still showed processing/empty cached body; do not claim the native result
  is displayed until the next successful completion-poll step proves it.
