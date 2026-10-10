# Agent profiles and predefined shipping forwarders — 2026-10-10

## Requirements

The user requested a menu for creating and managing reusable personal agent templates in Dovix. Templates belong to the selected company. They are individual agent presets, complementing the existing read-only bundled team catalog.

- AT1: An `에이전트 프로필` navigation item opens name/short-role cards and a selected profile's detail/editor on the right.
- AT2: Create, edit, duplicate and delete templates. Store template name, description, capabilities, instructions, adapter type, model and selected company skills. Profiles do not configure a fixed agent role or job title.
- AT3: Use a saved profile in the existing governed agent hire/setup flow. Keep agent identity, reporting, environment and authentication. Saving offers an explicit linked-agent propagation checkbox. Store immutable versions and durable pending bindings; apply after active work, before the next queued execution. Compare each field with its last profile value to preserve deliberate individual overrides. Deleting unlinks agents without deleting them; restoring a version creates a new revision.
- AT4: Enforce company scope, board/operator access, validation and mutation audit. Do not store provider credentials, runtime sessions, arbitrary commands or agent identity in template configuration. Stale edits produce a conflict.
- AT5: Verify persistence and authorization with a disposable real PostgreSQL database, verify the UI workflow through Aside, and deploy only the selected compatible change after an idle check.

## Technical plan

- Extend the established DB/shared/server/UI layers with company-scoped `agent_profiles`, immutable `agent_profile_versions`, `agent_profile_bindings`, typed strict schemas, a focused service/router and one page.
- Use an additive migration and the existing company skill records. Validate skill ownership before saving/applying a template.
- Reuse the existing new-agent setup route and its create endpoint; load a template by ID and send its instruction bundle/desired skills along with the existing setup payload. Preserve authentication and agent creation invariants.
- Use a revision number for conditional edits. Profile changes, pending bindings and audit entries commit together. Use existing agent start lock and canonical instruction commit/config revision services for propagation. Persist actor provenance for deferred writes, recheck authorization, and expose failures/overrides rather than silently losing changes. Do not introduce a timer, background watcher or parallel execution queue.
- The bundled teams catalog's missing runtime manifest is an independently diagnosed deployment fault; personal templates do not depend on its file loader. No plugin is introduced.
- Preserve dirty source files and the installed 2026.1001.0 compatibility baseline. Keep backups and pin deployment file hashes; avoid a full upstream replacement.

## Profile editor correction — 2026-10-10

The user rejected fixed role/category and title controls, reported losing an
unsaved form when visiting Skills, and requested visible model radio choices.
The existing form holds drafts only in component state. Its model input uses a
native datalist; the Codex registry bypasses discovery and returns a static list.
The installed CLI cache currently lists `gpt-6.1-sol` and `gpt-6-sol`.

- Remove role/title from the profile contract, editor, detail and propagation.
  Accept and discard these legacy JSON fields so existing profiles/versions
  remain readable without a destructive migration. Existing agents keep their
  own role/title. Profile hires use the ordinary general-agent defaults.
- Automatically retain the full form per company in browser-local storage,
  including profile identity, base version, skill choices and propagation
  choice. Restore after navigation/reload; add an explicit temporary-save
  action. Clear only after a successful permanent save or explicit cancellation.
  Failed saves retain the draft. Surface unavailable storage.
- Render default/model/manual choices as one accessible radio group. Fetch
  models through the existing scoped adapter API and expose refresh/loading/
  error/empty states. Read Codex's installed `models_cache.json` on each listing
  using `CODEX_HOME` or the user's default Codex home, preserving order/labels
  and excluding hidden entries. Do not substitute a fixed model list or use
  the general OpenAI API catalog, which includes non-Codex models. Existing
  explicit adapter-model configuration and other adapter discovery keep their
  existing precedence. Manual model IDs remain available.
- Work on `feature/agent-profile-drafts`, based on the preserved profile-bearing
  baseline. `develop` still lacks this coupled baseline; this branch depends on
  `feature/dovix-baseline` and does not bypass its recorded integration gates.
- Verify draft navigation/reload/isolation, failed/successful-save behavior,
  removed fields, radio selection, dynamic cache changes and legacy profile
  reads/propagation with focused tests. Record actual UI/build/runtime evidence
  separately from source checks.

Source validation for this correction:

- The navigation-loss regression failed before implementation, then passed
  with restored name/description and no server-side profile creation.
- Passed: four focused Vitest files / 48 tests (editor drafts/model selection,
  real disposable-PostgreSQL profile CRUD/legacy snapshots/propagation, adapter
  catalog discovery and model refresh routes).
- Passed: shared build, source UI typecheck/build, direct server TypeScript
  check/emission, token gates and `git diff --check`.
- Passed: the actual compatibility editor's 11 tests, its scoped TypeScript
  check and compatibility production build. The compatibility UI's complete
  typecheck reports existing settings/fixture contract differences outside the
  editor (including `keyboardShortcuts` and experimental-settings fixtures);
  no unrelated UI code was altered to hide those differences. Missing copied
  asset/package paths and dependency links were restored before building.
- Passed: importing the staged runtime strips legacy fields and returns the
  seven visible models in the installed CLI cache, including both requested
  Sol models. A read-only preflight found zero active heartbeat/plugin/
  publication/connection-check jobs.
- Graphify's updated code graph has 78,248 nodes / 222,777 edges; 233 zero-node
  files remain a coverage limitation. The draft helper's connection to the
  profile page was queried and checked against source.
- Whole-baseline release gates remain subject to the failures recorded in the
  Git reorganization plan. This scoped fix does not certify or merge that
  baseline. A selected compatibility rollout will record its source commit,
  file hashes, fresh rollback snapshot and actual API/browser proof below.

Operating rollout and browser validation completed for this correction:

- Deployed the selected compatibility UI and five runtime JavaScript files
  from source commit `eb6a0da4d64f12e8f708d34016aef9752640906e` to the managed
  `2026.1001.0` install. No database migration was needed. The entry is
  `index-Dqofugis.js`; the service worker uses the same build identity.
- The rollback files and deployment receipt are saved under
  `/Users/ydy1412/.paperclip/instances/default/data/backups/profile-editor-20261010T074655Z/`.
  The receipt records every old/new package-file hash. After application, all
  five installed hashes matched the candidate. The service restarted and
  reported healthy; before/after active heartbeat, plugin, publication and
  connection-check counts were zero.
- Live authenticated profile/model APIs succeeded, unauthenticated profile
  access was rejected, and all 48 referenced app-shell assets matched their
  candidate hashes. The model API returned seven visible CLI models, including
  `gpt-6.1-sol` and `gpt-6-sol`. This verifies catalog discovery, not execution
  of an agent with those models.
- Aside account `u1`, using an owned temporary tab, verified that role/title
  controls are absent and both Sol model radios can be selected. A temporary
  form retained its name, instructions and model after visiting Skills and
  returning. An additional edit made without pressing temporary save survived
  reload. Explicit temporary save worked and cancellation cleared the draft.
  No existing draft was present before testing; the test draft was removed,
  no production profile was permanently saved, and existing user tabs were
  preserved. Drafts are local to the same browser/origin, not cross-device.
- Browser evidence is in
  `tmp/agent-profile-editor-operating/profile-editor-proof.json`,
  `profile-editor-snapshots.json` and `profile-editor.png`. Initial tool probes
  failed on a restored textarea's exact-label selector and an early startup
  lookup; waiting for the rendered profile region and matching the observed
  textbox role resolved those tool failures. The final browser flow passed.
- To roll back, first confirm an idle operating instance, restore the five
  `package/` files listed in the receipt and the saved `ui-dist/index.html` /
  `sw.js` from that backup, then restart the managed service and verify health,
  authenticated APIs and shell assets. Old hashed assets were retained for
  already-open clients. The whole baseline remains unmerged and subject to
  its separately recorded integration gates.

## Execution checklist

- [x] Confirmed request, existing navigation, source/runtime boundary and existing template responsibilities.
- [x] Implement company-scoped profiles, immutable versions, bindings, scoped CRUD, skill validation, audit and version-conflict handling.
- [x] Implement profile cards/detail/editor, duplicate/delete/version restore and the existing new-agent setup handoff.
- [x] Apply linked profile updates before the next queued run; defer while an agent is running and hold queued execution if application is still pending or failed.
- [x] Seed the DB-backed forwarder catalog with the user-provided Next1688 homepage/login URLs; the settings form selects a saved provider and asks only for account ID/password.
- [x] Run shared, DB, UI and direct server TypeScript checks; run the UI production build.
- [x] Run profile/forwarder behavior tests and disposable-PostgreSQL integration tests.
- [x] Apply the additive migration to the operating instance after a safe idle check; verify health, authenticated APIs, authentication rejection and referenced UI assets.
- [x] Verify the rendered profile screen, menu navigation, bare URL redirect and reload through Aside. The previously open tab could not attach; an owned temporary tab worked.
- [ ] Verify the forwarder selector in Aside and a real Next1688 sign-in.
- [x] Reconcile this document with source changes, validation results and remaining limits.

## Validation and outcome

Source implementation is present in the working tree. Profile changes preserve agent identity, reporting and credential setup; initial profile content is validated on the existing hire endpoint and linked by immutable profile version. If a linked agent still has a run active, its pending version is kept and the heartbeat scheduler will not start another queued run until the profile applies. A failed propagation remains visible on the profile and also holds the next queued run.

The forwarder catalog is stored in `sourcing_forwarder_providers`; the application reads enabled providers from the database. The migration seeds `next1688` with the public URLs the user supplied and migrates matching legacy registrations. The form has no user-editable URL fields. No real Next1688 sign-in was attempted.

## Validation and remaining work

- Passed: `pnpm --filter @paperclipai/shared typecheck`.
- Passed: `pnpm --filter @paperclipai/db typecheck`, including migration numbering and safety checks.
- Passed: `pnpm --filter @paperclipai/ui typecheck` and `pnpm --filter @paperclipai/ui build`.
- Passed: `pnpm --filter @paperclipai/server exec tsc --noEmit`.
- The standard server typecheck stopped in its prerequisite Paperclip Runner capability-inventory check because it reports stale source rows in the runner skill documentation; direct server TypeScript compilation passed.
- Passed: `pnpm exec vitest run server/src/__tests__/agent-profiles.test.ts server/src/__tests__/sourcing-forwarders.test.ts` (2 files, 16 tests).
- Passed: `pnpm exec vitest run ui/src/pages/AgentProfiles.test.tsx ui/src/components/SourcingForwarders.test.tsx` (2 files, 11 tests).
- Passed: a disposable embedded PostgreSQL instance applied the installed-runtime migration chain through `0289_agent_profiles_and_forwarder_catalog.sql`; the profile and instruction-revision tables were queryable and `넥스트배송` was seeded.
- Deployed to the managed `2026.1001.0` runtime. The pre-deploy database backup is `/Users/ydy1412/.paperclip/instances/default/data/backups/agent-profiles-predeploy-20261010-20261010-054344.sql.gz`; selected package files and the prior UI bundle are backed up under `/Users/ydy1412/.paperclip/instances/default/data/backups/agent-profiles-runtime-20261010-054344/`.
- Production verification passed after restart: health returned 200/`ok`; the authenticated Agent Profiles API returned a list; the provider API returned the configured Next1688 URL; unauthenticated profile access was rejected; all 48 app-shell asset references returned 200; the service worker matched the deployed entry. No heartbeat, plugin, publishing or connection-check job was active after restart.
- The initial Aside visual check failed because its live-tab Page.enable timed out. During the subsequent route correction an owned temporary tab verified the profile screen, navigation and reload. Forwarder browser verification and a real Next1688 sign-in remain unverified. A first post-migration verifier expected an internal provider key that the public API intentionally omits; runtime files were restored, then the assertion was corrected and the deployment completed. The additive DB migration was retained.
- `pnpm dev:list` reported no dev service registered for this repository. The installed runtime is a separate managed CLI install, so the compatible selected-file rollout was used rather than replacing it from the dirty source tree.
- The existing Graphify queries returned historical module nodes (`forwarderUrl` and `agentContinuityService`) rather than the current profile/provider implementation. The index is stale for this change; current source was checked narrowly, and no whole-repository refresh was run across the already-dirty worktree.

## Predefined forwarders

- SF1: Replace URL/name form inputs with a DB-backed provider selection; initially seed the user-provided Next1688 homepage and login URL. Only account ID/password are required from the user. Allow independent registrations for the same provider.
- SF2: Store public provider definitions in an instance-wide DB reference catalog (contains only names/public HTTPS URLs, an explicit company-scope exception); keep encrypted account registrations company/project-scoped. Server resolves and validates enabled providers; arbitrary client URLs are rejected. Preserve existing account aliases and encrypted secret versions. Match existing Next1688 records during migration; unmatched legacy records remain readable/openable but require a catalog provider to edit.
- SF3: Snapshot the provider URLs in each registration. Changing provider/site requires fresh credentials. Catalog changes appear on the next provider-list request; saved account credentials are never silently forwarded to a changed domain.
- SF4: Extend existing forwarder API/UI/tests. Verify synthetic encrypted-account fixtures and Aside UI; do not claim a real Next1688 login succeeded from mocked tests.

## Validation to record

Record focused PostgreSQL integration tests, UI behavior tests, affected package checks/builds, graph refresh, compatible installed-runtime checks and Aside proof. Deployment must preserve existing dirty changes and use backups plus an idle check. Any unmet check stays unchecked.

## Operating route correction — 2026-10-10

The user reported `Organization not found` at `/agent-profiles`. The current source board-route allowlist includes `agent-profiles`, but the compatibility UI used for deployment omitted it. The company router consequently treats the menu path as the company prefix `AGENT-PROFILES` and skips the selected-company prefix. Both source and compatibility App tables also lacked the bare-URL redirect registration.

Correction plan: add a regression covering menu href classification, company-prefix application, and relative-path round trips; run it against both source and the actual compatibility UI; restore the missing allowlist entry in the compatibility UI; rebuild and deploy only the UI shell/assets with a fresh rollback snapshot. Do not change the database or restart active agent processes for this static-UI fix.

- [x] Compare the reported path with the current source and operating compatibility UI.
- [x] Demonstrate the failing compatibility-route regression, then verify the correction.
- [x] Build and deploy the corrected UI with matching service-worker build ID and referenced-asset checks.
- [x] Verify actual browser navigation through Aside, or record its concrete blocker.

Hindsight recall confirmed the source/runtime boundary and the earlier profile decisions, but its deployment status predates the latest rollout. The existing Graphify graph has no `company-routes.ts` nodes; its bounded routing traversal did not cover this bug, so the allowlist and router were verified directly in the narrow current-source files.

Validation: the compatibility helper regression failed before the allowlist correction. Source `company-routes.test.ts` and `AgentProfiles.test.tsx` passed 26 tests; the new `ui/src/App.agent-profiles-routing.test.tsx` passed 3 tests against the real App table, covering both UI modes and preserving an already specified company. The compatibility App/helper suite passed 20 tests. UI typecheck and compatibility production build passed; logs are `tmp/agent-profiles-operating/route-fix-{app-tests,compatible-tests,typecheck,build}.log`. The compatibility preparation script now carries both registrations and avoids the duplicate nested profile route.

The UI-only rollout completed without a server restart or DB changes. Its entry is `index-D73A3EQ3.js`; all 48 live shell asset references matched the candidate hashes, the service worker matched the new build ID, and health returned `ok`. The previous shell and receipt are saved at `/Users/ydy1412/.paperclip/instances/default/data/backups/agent-profiles-route-fix-20261009T211345Z/`. Existing hashed assets were retained for already-open clients.

Aside account `u1` reproduced the original organization-prefix error before deployment. After deployment, the bare URL redirected to `/DOB/agent-profiles`, dashboard-menu click opened the profile page, and a reload showed the profile screen after its initial loading transition. The old tab attachment still timed out; the temporary-tab path worked. A role-locator reload wait also timed out, so the settled result was verified with fresh snapshots. The operating profile list is empty; no production profile or account credentials were created during this repair.
