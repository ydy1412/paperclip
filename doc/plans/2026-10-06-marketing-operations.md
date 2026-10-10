# Marketing operations

## Agent draft plugin (2026-10-07)

Approved: expose the existing Marketing drafting workflow as an installable
Paperclip plugin, not a second CMS or an external posting service. Agents use
named tools to discover projects/profiles/channels and editorial rules, upload
real task-workspace image/video files, and submit drafts. The writing skill
instructs agents to submit after a normal content request, without requiring
the operator to name tools or APIs. Publication/approval/retry tools are excluded.
Keep current Marketing list/details, author provenance and approval boundaries.

Extend the established plugin SDK/host bridge with capability-gated Marketing
methods. The host issues an opaque invocation binding carrying the authenticated
agent/run/project identity; never accept worker-selected identity, tokens, hosts
or arbitrary HTTP paths. Validate the live run, native task/chat ownership,
company, active work mode and selected project on every call. A project task
cannot select another project. An unscoped agent conversation may explicitly
select an active same-company project; ambiguous targets require clarification.
No account mutation, external media fetch, posting or credential exposure.

Add nullable `marketing_drafts.generation_run_id` and a partial unique index for
company/channel/run. Make this additive migration repeatable because the older
operating host receives it before a later full migration-journal upgrade.
Existing APIs and issue-scoped idempotence stay compatible.
Plugin submissions are run-scoped, allowing later conversation turns to create
new drafts without overwriting operator edits. Only attachments from the chosen
project or the authenticated source conversation may be used; preserve those
attachments in preview and approval validation. Uploads use bounded local native
workspace file resolution and existing attachment storage/registration.

Implementation: reusable plugin package under `packages/plugins/`, existing SDK
types/protocol/worker/host factory, shared capability declarations, a focused
server-side Marketing plugin bridge, existing Marketing persistence/service and
writing skill. Deliver plugin discovery/calls through the existing authenticated
project-tools MCP endpoint in standard work mode, using the existing tool gateway
for policy, audit and worker dispatch. Task/chat/run identity is derived server-side.
No new browser automation, external MCP server, scheduler or UI.
Keep routine requested Marketing draft submission in the current standard-mode
conversation rather than creating an implementation task. The chat directive
must distinguish this bounded plugin handoff from substantial project execution;
normal permissions, media containment, work modes and publication approval remain
mandatory. Do not change project authentication to make a test pass.
Back up operating code/DB before applying a compatible host/plugin candidate;
install and enable through the native plugin API, retain prior plugin/service
state and publication records, and provide code rollback without deleting drafts.

Execution checklist:
- [x] Record and implement SDK/host authority and installable draft tools
- [x] Preserve normal task flow and support explicit-project agent conversations
- [x] Test capabilities, ownership, uploads, duplicate submissions, later runs,
      stale runs, project boundaries, author provenance and approval separation
- [x] Build/typecheck and apply a compatible backed-up operating plugin
- [x] Give the existing marketer a natural topic-only request, verify native
      tool calls and actual Marketing registration without external publication
- [x] Verify operating screen through Aside and reconcile docs/graph/memory

Implemented `packages/plugins/plugin-marketing-drafts/`, the existing SDK
Marketing RPC surface, opaque authenticated `executeTool` scope and
`server/src/services/marketing-plugin.ts`. Native discovery/calls use the existing
`/api/mcp/project-tools` connection and gateway. The standard-mode chat directive
allows this bounded draft handoff, not general project implementation. Normal
task APIs remain issue-scoped; plugin creation is run/channel-scoped. Media may
come from the selected project or authenticated current conversation; project
media discovery does not expose unrelated conversation attachments. Local upload
is bounded, uses native workspace containment and real attachment storage, and
deduplicates sequential same-file/run uploads. Concurrent upload deduplication is
not claimed. The additive `0299_marketing_plugin_draft_run.sql` is repeatable;
later migration-journal upgrades can replay the operating overlay safely.

Verification: 286 tests across 11 focused root files plus 5 plugin-package tests
passed (291 total, not the full monorepo suite). Coverage includes native isolated
PostgreSQL authority, foreign/disabled targets, duplicate submissions, later
conversation runs, stale conversation generation, upload bounds/path rejection,
repeatable migration, gateway delivery, author attribution and no publication.
The upload test's MP4 fixture checks transport, not real video rendering; actual
operating playback below used an existing valid project video. Commands:
`pnpm exec vitest run server/src/__tests__/marketing-plugin.test.ts server/src/__tests__/project-plugin-tools.test.ts server/src/__tests__/marketing-service.test.ts server/src/__tests__/marketing-publication.test.ts server/src/__tests__/marketing-dispatch.test.ts server/src/__tests__/marketing-connection-checks.test.ts server/src/__tests__/marketing-aside-session.test.ts server/src/__tests__/plugin-worker-manager.test.ts server/src/__tests__/agent-conversations.test.ts packages/plugins/sdk/tests/host-client-factory.test.ts ui/src/pages/Marketing.test.tsx`,
`pnpm --dir packages/plugins/plugin-marketing-drafts test`, package typecheck/build,
SDK/shared builds, DB types, `pnpm exec tsc --noEmit -p server/tsconfig.json`,
`pnpm --dir ui exec tsc --noEmit`, `pnpm --dir ui build`,
`node scripts/check-token-gates.mjs` and `git diff --check` passed. Existing Vite,
CSS highlight, localstorage and large-chunk warnings remain.

Operating installation is compatible with the older installed host; it is not a
whole-server upgrade. The existing helper
`tmp/marketing-dev/plugin-drafts-update.mjs` prepared/import-verified ten host
files, backed up code and a mode-600 DB dump, applied additive schema and installed
the native plugin. A separately backed-up chat-directive paragraph was ported
without replacing unrelated conversation logic. Backup:
`tmp/marketing-dev/production-backup/plugin-drafts-1791363055323/`.
Plugin `c34dbfc3-3ebd-4c7a-a277-75a28694b894` is ready with three tools.
Native company permission profile `marketing-drafts`
(`ffe78eae-804b-43ab-bcaf-1fce737d8374`) defaults to deny and explicitly includes
only those three tools. Existing account/posting/other-tool permissions remain
unchanged. The existing writing skill is revision 5
(`ce53f419-5b32-4d2f-9e7f-0909fc7b54b2`), with exact source read-back verified.
No model or credential changes; the marketer still uses `gpt-6-luna`.

Live proof: conversation DOB-25 (`8138ced2-92ae-4244-971b-b2471b348377`), run
`d17e5b94-f971-41e4-9f06-a140fb9a39c7` succeeded. A natural blog-writing request
with a clear project/channel caused actual `get-draft-context` and `submit-draft`
calls and draft `76e5d95e-44df-479a-a3e4-87c31c75bb1f`, with 2052-character body,
native author provenance and two existing project attachments. Aside showed the
new list row, selected detail, author tag, loaded 1080px image and 1080px video
(duration 3 seconds, readyState 4, no playback error), without horizontal overflow.
Capture:
`/Users/ydy1412/.aside/u/1/sessions/2026-10-07_YpOcvHpXPP45FhGI/artifacts/marketing-plugin-draft.png`.
This first run verifies project-media reuse, not new-file upload or editorial
review of generated claims/alt text. No external post/approval/job was created. Existing
publication-record and operating-UI hashes match the backup; Hindsight readiness,
artifact/folder APIs and disabled internal Threads channel were preserved.

Follow-up live upload: run `50151b5d-f445-4a1d-897a-abf5fd53af24` succeeded
after a natural request to use real files prepared in the current workspace.
The agent called `get-draft-context`, `upload-draft-media` twice and
`submit-draft`, creating draft `e1f5a244-966e-48d3-938b-22c98f73fba6` with new
PNG attachment `5f71f223-8e98-45a8-992a-8dd2f0d1693c` (87493 bytes) and MP4
attachment `d3d16820-4618-4ebb-8a18-4da38cd33f8b` (239343 bytes). Each native
attachment's originating run, byte size and SHA-256 matched the real staged
project file. This proves upload, not creation of new visual media. Aside showed
the new author-tagged list/detail and both uploaded files rendering successfully
(image 1080px, video 3 seconds/readyState 4/no error), without horizontal overflow.
Publication-record hash remained unchanged. Capture:
`/Users/ydy1412/.aside/u/1/sessions/2026-10-07_8MbrynEjmf3GPDZ5/artifacts/marketing-plugin-upload.png`.

The first unscoped chat and an obsolete handed-off task hit the existing managed
AI/project authentication conflict. The live test used the selected project's
native isolated workspace, without modifying credentials/global configuration or
the auth guard. The initial tool search also exposed missing explicit tool
permissions; the exact three-tool native profile resolved that. A chat directive
fix removed the unnecessary implementation-task handoff. Test task DOB-26 was
cancelled after direct-chat submission succeeded; history remains available.

Rollback is prepared, not executed in this successful deployment. `--rollback`
disables only this plugin, unbinds its company permission profile, restores prior
writing guidance subject to the exact version guard, and restores original host
files including the chat directive. It keeps new drafts/media and additive schema.
Never rerun initial `--apply` on an already applied overlay. Existing unrelated
working-tree changes were preserved; no commit was made.

Hindsight was queried and the bounded plugin decision/live result was retained
as `marketing-native-draft-plugin-2026-10-07` in this checkout's project bank;
the later actual upload proof is separately retained as
`marketing-native-draft-plugin-live-upload-2026-10-07`. Source-bearing read-back
matched both records. Existing scoped Graphify output was queried and
refreshed to 46 AST files, 556 nodes / 889 edges / 27 communities. It still has
1129 dangling raw references and 31 collapsed endpoint edges, so current source
and runtime evidence remain authoritative. No answer-memory save or hooks.

Validation boundaries:
- [ ] Resolve the existing authentication conflict for new projectless chats;
      this change proves the selected-project conversation, not every chat setup
- [x] Exercise new-file upload through a live agent, verify stored bytes/run,
      and inspect actual uploaded image/video rendering through Aside

## Post list and detail workspace (2026-10-07)

Approved layout: retain project/profile/channel selection, connection checks and
Aside publication progress on the left. The middle pane lists submitted posts,
with a checkbox before each row, author provenance, target channel, attachments
and publication state. Selecting a row opens read-only title/body/media details
on the right. Remove draft tabs, creation/generation/import controls, the editable
draft form and save/selected-publication buttons. Keep one footer `발행` action
for the checked posts, with an explicit content/account/revision confirmation.
Agent authoring/import APIs and skills remain available; this is not permission
to submit an external post during verification.

Use existing Marketing page, replace its editor component with a focused detail
component, and extend existing marketing CSS tokens. No schema/server/API change.
Default selection is empty. Row selection and five-second state refresh preserve
checked posts; changing company/project/profile/channel clears them. Whole-list
selection includes only eligible visible posts. Queued/publishing/published or
uncertain versions cannot be selected again; failed/auth-required versions keep
their explicit recovery path, never a new blind dispatch. Unsupported media,
disabled/blocked bindings and stale/error state cannot be approved. Confirmation
captures the reviewed content and binding and must be renewed after either
changes. Queue/dispatch failure retains usable state and visible recovery; never
resend a queued batch automatically. Existing read-only reconciliation, cancellation
and evidence-gated retry controls live under selected-post publication details.

At desktop widths use three unframed columns and a sticky footer under list/details
so the single publication action remains visible while reading long posts;
at narrower widths stack sidebar, list, detail and footer without overflow.
Loading, empty and failed reads remain explicit; cached content is preserved on
transient refresh errors. Preserve existing uncertain publication records and
disabled internal test channels. Apply only a compatible UI build with a prior
UI backup; do not restart or modify backend/DB for this layout update.

Execution checklist:
- [x] Implement submitted-post list, read-only details and one bulk action
- [x] Test selection, exact approval, changed revisions, duplicate prevention,
      dispatch failure and existing connection/recovery behavior
- [x] Run focused tests, UI types/build and token gates; audit scoped graph changes
- [x] Back up/apply compatible operating UI; verify desktop/narrow layouts in Aside
- [x] Reconcile documentation and report actual scope and remaining limitations

Implemented `ui/src/pages/Marketing.tsx`, focused author/detail rendering in
`ui/src/components/MarketingDraftDetail.tsx` (replacing the unused editor), and
existing CSS tokens in `ui/src/index.css`. Footer approval captures checked posts
without selecting them automatically. Unsupported/already-submitted versions are
disabled, but an invalidated checked row can still be unchecked. Preserve the
existing 50-post batch limit without silently truncating whole-list selection.
Read-only reconciliation, explicit queued-job dispatch, cancellation,
evidence-gated retry and blocked-profile recovery remain inside collapsed
publication history. New drafts/generation/import/edit APIs remain intact; their
removed page controls are intentional. Transient read failures preserve selection
and content; confirmed HTTP 401/403 hides cached content and closes approval.

Verification: six focused Vitest files / 129 tests passed, including 55 Marketing
UI cases and real isolated PostgreSQL publication/connection tests. Commands:
`pnpm exec vitest run ui/src/pages/Marketing.test.tsx server/src/__tests__/marketing-dispatch.test.ts server/src/__tests__/marketing-service.test.ts server/src/__tests__/marketing-publication.test.ts server/src/__tests__/marketing-connection-checks.test.ts server/src/__tests__/marketing-aside-session.test.ts`,
`pnpm --dir ui exec tsc --noEmit`, `pnpm --dir ui build`,
`pnpm check:token-gates`, and `git diff --check` all passed. Existing highlight,
bundle-size and Vite configuration warnings remain; not a full monorepo suite.

Operating-compatible UI prepared/applied/verified with the existing
`tmp/marketing-dev/connection-sidebar-update.mjs` UI-only modes
`--prepare-ui`, `--apply-ui`, `--verify-ui`, `--rollback-ui`.
Backup: `tmp/marketing-dev/production-backup/connection-checks/post-workspace-1791357778981/`.
Earlier same-change UI backups remain available. Assets are copied before index;
old hashed assets remain accessible. No server restart, service-file replacement,
schema migration, DB mutation, environment/account change or external publication.
Plugin readiness, artifact/folder APIs, publication-record hash and disabled
internal channel were preserved. UI-only rollback leaves all DB records intact.

Aside confirmed actual operating list/detail selection and refresh, no authoring
toolbar, one visible sticky publish action, and the existing uncertain version
remaining disabled. Desktop 1440px had no horizontal overflow; footer bottom
was 876px in the 900px viewport. Same-origin Aside-owned iframe checks at 390px
(375px usable width after the vertical scrollbar) and 768px showed no horizontal
overflow in document or main panes. This is viewport testing, not physical-device
proof. Temporary owned tabs were closed; original browser tabs were preserved.
Bulk request/approval failure behavior is covered by API mocks and isolated
server tests, not a real external post in this change.

Responsive captures:
`/Users/ydy1412/.aside/u/1/sessions/2026-10-07_pWd6dN7iOVIVN21e/artifacts/marketing-post-workspace-{390,768}.png`.
Hindsight recall informed sidebar ownership and publication-preservation boundaries.
The existing 37-file AST graph was queried and refreshed to 349 nodes / 566 edges.
Raw extraction still has 886 dangling references and one collapsed endpoint pair;
it is an incomplete scoped graph, not proof of runtime behavior. Sources/tests
remain authoritative. The existing uncertain external publication and real
LinkedIn concurrency remain separate, unresolved live prerequisites.

## Marketing sidebar and connection refresh (2026-10-07)

The operator places project/profile/channel selection and all connection controls
in the left sidebar, directly below the profile/channel actions. The right pane
contains draft creation, editing, approval and publication only. Remove the old
Naver-only account-check UI; every supported channel uses the async check queue.
Keep profile/channel settings on the left, selected rows clear, and long labels
wrapping. Use the existing token layer and compact unframed sections. At narrow
widths the sidebar precedes the draft workspace in a single column.

Show visible enabled channels, separate account verdict from work progress,
display the last verified time, and collapse native session/model details.
Automatic monitoring remains project-wide and is labelled as such. Manual batch
checks are scoped to the visible profile; disabled profiles/channels are excluded.
Polling or failed refresh must preserve cached channel state and unsaved drafts.
Invalidate connection queries after channel/profile edits and explicit refresh.
Return the latest check for every channel even when another channel has more than
200 historical checks. Account/profile rebinding clears old verification; content
rule/name edits preserve it. Existing failures never delete channels.

Execution checklist:
- [x] Move connection/settings controls left and remove duplicate Naver check UI
- [x] Test profile-scoped checks, failure recovery and preservation of draft edits
- [x] Fix and test latest-per-channel lookup and binding verification invalidation
- [x] Run focused tests, types, UI build and token gates
- [x] Back up and apply the compatible operating update; verify with Aside

Verified: six focused Vitest files / 123 tests passed, including 46 Marketing UI
tests and 13 native PostgreSQL connection tests. Regression tests first reproduced
lost checks after 205 other-channel results and stale connected status after
rebinding. Active work takes precedence in the latest-per-channel response.
Server/UI TypeScript checks, UI production build, compatible operating UI build,
token gates and `git diff --check` passed. Existing CSS highlight/chunk-size build
warnings remain. Commands are the focused six-file command recorded below,
`pnpm exec tsc --noEmit -p server/tsconfig.json`, `pnpm --dir ui exec tsc --noEmit`,
`pnpm --dir ui build`, and `pnpm check:token-gates`.

Operating update: `tmp/marketing-dev/connection-sidebar-update.mjs` prepared
three service files (marketing, queue, bundled workflow) and compatible UI.
Code/DB backup: `tmp/marketing-dev/production-backup/connection-checks/sidebar-1791319821186/`.
Native imports, API, Knowledge plugin, artifact/folder endpoints and publication
record hashes passed after restart. `--rollback` restores prior code/UI without
deleting new records. The exact internal Threads draft fixture was disabled using
the existing channel API, retained with its drafts/history under collapsed
"중지한 채널", and excluded from automatic/manual checks and publication admission.
Rollback leaves this intentional fixture deactivation in place.

Aside confirmed the connection panel below profile/channel actions, settings in
the sidebar, and no connection control in the draft workspace. A fresh click on
the operating sidebar created a new native session and returned connected at
2026-10-07 05:52:30 KST. Prior status remained visible while queued; no post was
submitted. Fresh UI observation confirmed the updated timestamp and completed
state. Desktop viewport 1485px had no horizontal overflow. Within Aside, owned
same-origin iframe viewports at 390px and 768px rendered the actual operating app
without horizontal overflow; sidebar preceded the editor. These are responsive
viewport checks, not physical-device tests. Temporary owned tabs were closed.

Final screenshot:
`/Users/ydy1412/.aside/u/1/sessions/2026-10-07_GvMypF9R1UxFKI3e/artifacts/marketing-sidebar-final.png`.
Responsive captures:
`/Users/ydy1412/.aside/u/1/sessions/2026-10-07_htq9iKAdm9vGu1fH/artifacts/marketing-sidebar-{390,768}.png`.

Hindsight decisions were recalled; the existing 37-source Graphify corpus was
queried and refreshed (348 nodes / 562 edges). The one-node shrink was audited as
the intentionally removed duplicate MarketingConnectionChannelDot component.
Raw extraction still reports 898 dangling references and one collapsed pair;
the scoped graph is incomplete, so current source and tests decide behavior.
New SNS discovery/registration and LinkedIn live concurrent verification are not
established by this layout update or its mocked multi-platform UI tests.

## Non-blocking owner verification (2026-10-07)

Requested correction: an advertisement or auxiliary loading delay must not negate
an already verified signed-in owner. This section supersedes the blanket loading
failure/model-unknown veto described in the initial async implementation below.

Keep the existing strict final-result envelope and queue fencing. Account mismatch,
conflicting evidence and a real authentication gate never establish connected.
When the exact signed-in target matches, owner-only controls are present and no
authentication gate is present, apply connected independently of auxiliary loading
failure or Laya abstention/confidence. Preserve the original model choice and
probability for inspection. Public target URL alone or generic owner controls alone
are insufficient. Missing identity remains unconfirmed, not failed or deleted.

Update the existing Aside inspection prompt to wait for the needed identity/control
elements rather than all network traffic. If navigation readiness times out, inspect
the already-created inspection tab's current URL and visible controls; do not keep
reloading MyBlog after proof is already available. For Naver, a matching MyBlog
redirect plus owner controls is identity evidence even if ads continue loading.
For a public target page, independently check the signed-in owner control/link.
Do not guess a match or dismiss security/verification prompts as advertisements.
No login, account switching, posting, model retraining or schema change.

Checklist:
- [x] Add regressions for auxiliary loading, model abstention and unknown identity
- [x] Adjust owner-proof precedence and Aside inspection instructions
- [x] Validate focused tests/types and back up the existing operating boundaries
- [x] Apply compatible service files and request a fresh read-only Naver check
- [x] Verify fresh final result, applied verdict and operating UI; update graph

Verified outcome: two regressions failed against the old veto, then passed after
the precedence change. Six relevant Vitest files passed 119 tests (including 11
durable connection tests and 44 Marketing UI tests); server typecheck and final
diff whitespace validation passed. Existing installed-compatible service import
probe confirmed owner proof applies connected even with model unknown and an
auxiliary loading failure, while missing owner identity stays unknown.

Only `marketing-connection-workflow` and `marketing-connection-aside` operating
service boundaries were rebuilt and replaced. Code and DB were backed up under
`tmp/marketing-dev/production-backup/connection-checks/owner-proof-1791318279226/`;
rollback restores the two previous service files and retains all DB records.
The operating API, Knowledge plugin readiness, artifact/folder endpoints and
unchanged publication-record hash were rechecked after restart. No migration,
UI source change, environment change, model retraining or full monorepo build.

A fresh read-only operating Naver job followed queued -> preparing -> waiting ->
result_received -> classifying -> completed. Saved evidence: ownerMatches=true,
ownerControlsPresent=true, authenticationRequired=false, loadingFailed=false,
conflicting=false. Raw Laya also chose connected at 0.8695; applied/channel status
is connected. `tmp/marketing-dev/owner-proof-candidate/live-proof-private.json`
retains the bounded native observation/result and side-effect flags. Earlier
unconfirmed results were not edited or relabelled. The actual Aside Paperclip tab
displayed "네이버 블로그 판정 완료 계정: 연결 정상" with the new saved session, without
refreshing/replacing the locked draft. No posting or authentication mutation.

Graphify's existing 37-file structural graph was queried before edits and refreshed
afterwards (349 nodes, 562 edges). Hindsight recall supplied the earlier navigation
timeout counterexample. The actual fresh run had no loading failure, so tolerance
of an advertisement timeout is regression-tested, not claimed as a newly observed
live advertisement failure. Unknown identity or real conflicting/security evidence
still remains unconfirmed. The pre-existing uncertain publication is separate from
the now-normal connection status and was not repaired by this change.

## Async connection checks with LangGraph (2026-10-07)

Approved scope: separate PostgreSQL connection-check queue, LangGraph JS with
PostgresSaver synchronous checkpoints, board/company-scoped 202 acceptance,
manual channel/project checks and default-off ten-minute project monitoring.
Publishing, retraining, Redis and another HTTP service are excluded.

Owners: existing marketing schema/shared contracts; connection queue service
owns atomic admission, leases, deduplication, scheduling and fenced writes;
LangGraph workflow owns preparation/request/wait/validation/classification;
Aside boundary owns native session calls; existing Laya boundary owns inference.
Persist the session before dispatch, record dispatch intent before the side
effect, and never resend ambiguous requests. Interrupt waiting and poll native
state every five seconds (transient failures back off to thirty seconds).
Limits are three active Aside checks, one active check per channel and one Laya
inference. Shutdown/restart retains queue and checkpoints. Account binding
changes invalidate results. Idle alone is never a result. Final results must
match job, channel, session and target. Laya sees only platform, target and a
bounded credential-free observation. Failure/conflict/wrong account/low
probability preserves the prior connection state; raw and applied verdicts stay
separate. UI completion dots and actual account verdicts are distinct. Five-second
UI polling also continues while the tab is in the background, without replacing
draft state. Verify the global Laya advisory lock with competing workflows.

Before operating changes, back up code and DB and verify Knowledge/artifacts.
Use the established compatible overlay, not all checkout migrations against the
older installed runtime. Rollback preserves additive tables and job records.

Execution checklist (only verified items may be checked):
- [x] Resolve checkout and recall the real timeout misclassification
- [x] Query existing scoped graph; verify affected sources and approved scope
- [x] Implement additive DB/shared/API/queue/LangGraph and UI polling
- [x] Test dedup, authorization, monitor OFF, durable recovery and stale writes
- [x] Verify timeout evidence preserves old connection despite model verdict
- [ ] Check real Naver/LinkedIn bindings and concurrent distinct sessions
- [x] Verify operating UI progression, reload and session tracking
- [x] Verify actual ten-minute scheduling, deduplication and OFF
- [x] Verify isolated restart resumes the same native session
- [x] Run relevant tests/types/build/token gates; apply compatible overlay

Live tests are read-only; do not publish, log out, switch accounts or bypass
authentication. Missing LinkedIn credentials/binding is an incomplete live test,
not permission to manufacture a passing fixture.

### Implementation and verification record

Implemented `marketing_connection_checks`, `marketing_connection_monitors` and
the channel verdict fields in additive checkout migration
`packages/db/src/migrations/0298_marketing_connection_checks.sql`. Queue ownership
is `server/src/services/marketing-connection-queue.ts`; native inspection and
strict final-result validation are `marketing-connection-aside.ts`; actual JS
LangGraph/PostgresSaver execution is `marketing-connection-workflow.ts`. Existing
marketing routes, application startup/shutdown and shared types were extended.
UI/API changes use `ui/src/components/MarketingConnectionStatus.tsx`, existing
Marketing page/API and token-only CSS. Completed dots never establish a connected
account without the separately displayed applied verdict. No publishing route or
existing publication record was changed by connection verification.

Passed focused validation on 2026-10-07:

```sh
pnpm exec vitest run server/src/__tests__/marketing-connection-checks.test.ts server/src/__tests__/marketing-service.test.ts server/src/__tests__/marketing-aside-session.test.ts server/src/__tests__/marketing-laya.test.ts server/src/__tests__/marketing-dispatch.test.ts ui/src/pages/Marketing.test.tsx
pnpm exec tsc --noEmit -p server/tsconfig.json
pnpm --dir ui exec tsc --noEmit
pnpm --dir server exec tsc --ignoreConfig --noEmit --types node --target es2022 --module nodenext --moduleResolution nodenext --skipLibCheck scripts/marketing-connection-live-check.ts
pnpm --dir ui build
pnpm check:token-gates
pnpm --dir packages/db check:migrations
git diff --check
```

Six Vitest files, 117 tests passed (9 durable queue/workflow tests and 44 Marketing
UI tests). Tests use a real isolated PostgreSQL and PostgresSaver, including
competing queue owners, single Laya inference, expired ownership, changed target,
ambiguous dispatch intent and the historical 0.8918 timeout misclassification.
All type checks/builds/token gates passed. Existing CSS highlight and bundle-size
warnings remain. Migration safety reports only the 20 historical baseline items.
This is focused validation, not the entire monorepo suite.

Actual read-only Naver + unchanged local Laya evidence:
- `server/scripts/marketing-connection-live-check.ts` starts an isolated DB and
  direct worker process using the existing explicitly bound Aside profile.
- `tmp/marketing-dev/connection-live-20261007/report.json` recorded actual automatic
  admission after 601249 ms, one automatic job, and no new admission after OFF.
  The manual and automatic observations ended unconfirmed and preserved state;
  the manual observation included a loading failure, not an authentication gate.
- The first harness attempted to kill a tsx wrapper, leaving its worker alive.
  Its restart flag is NOT crash-recovery evidence. The verified orphan was stopped
  and isolated resources cleaned up; the historical report is preserved.
- The corrected `--quick-restart` harness uses Node's tsx loader directly.
  `tmp/marketing-dev/connection-restart-20261007/report.json` records actual worker
  termination, a different worker PID, the same saved native Aside session and
  final classification without duplicate request. All seven observed workflow
  stages include result arrival and classification. Its DB/worker were cleaned up.
- LinkedIn native identity lookup failed (redirect/fetch failure), and a fresh
  read-only browser inspection reached the login page. A separate bounded Aside
  inspection also could not confirm an authenticated owner. No configured real
  LinkedIn channel was available. Authentication/account binding and real dual-SNS
  overlap remain unverified; no login, logout or substitute fixture was performed.

Operating-compatible candidate was built against the installed runtime, including
a bundled LangGraph boundary. An isolated copy loaded the bundle and set up real
PostgresSaver before application. Backup and rollback receipts live under
`tmp/marketing-dev/production-backup/connection-checks/`: code/UI archive, private
DB dump, private environment backup and verified baseline. Installed migration
`0286_marketing_connection_checks.sql` is the same additive change with the older
runtime's next number; other checkout migrations were NOT applied. The service
was restarted and `/connection-checks` returned HTTP 200 with automatic OFF.
Knowledge plugin readiness, artifact/folder APIs, configuration, launchd settings
and existing publication-record hashes were preserved. A later UI-only background
polling update has its own backup and index-hash receipt. Code rollback preserves
new queue rows and additive schema.

Graphify's existing scoped AST corpus was refreshed to 37 files, 349 nodes and
562 edges. It is structural source evidence, not live/browser correctness; raw
external references outside scope are reported separately, not invented edges.
Project Hindsight recall supplied the earlier high-confidence timeout counterexample.

Operating Aside UI proof: per-channel Naver button accepted immediately, displayed
queued/preparing/waiting, then a green final-arrival dot and separate unconfirmed
account text. Polling continued without reload after the background-query update.
The API also recorded classifying; the capture at that brief stage still showed
the prior polling-frame's pending label, not proof of the in-progress label's
live rendering. That specific label is covered by the UI tests. Final red
attention state, raw model confidence and the same native session survived reload.
`tmp/marketing-dev/connection-ui-proof-private.json` links the native Aside
snapshots/screenshots. At the actual 1485x870 viewport there was no horizontal
overflow, and connection dots remained 8x8. Draft selection and the pre-existing
uncertain publication remained unchanged. No mobile viewport test was performed
for this connection-only scope.

Remaining limitation: Laya still abstains on some observed Naver owner pages.
Guarding that uncertainty is implemented; classifier accuracy has not been improved
or re-trained. The connection feature is operational, but the approved complete
real-use criterion remains unmet until real LinkedIn binding and simultaneous
Naver/LinkedIn inspection are verified. Local inference still uses the existing
ignored temporary Python environment/checkpoint through explicit absolute paths.
Do not clean that directory while the operating service depends on it; the
code/DB backup does not include model weights. Moving inference assets to a durable
operator-managed location is a follow-up deployment-hardening task, not completed
by this connection-only change.

## Read-only Laya connection check (2026-10-07)

Historical test record before the async integration above. Statements below about
no production integration or deployment describe that earlier test only; the
current operating implementation and remaining limitations are recorded above.

Requested: connect the trained local Laya model to the real Paperclip/Aside
channel-state flow and verify actual usage, not additional synthetic cases.
The operator's live Paperclip marketing configuration identifies one real Naver
Blog channel using Aside u1 / Profile 1; the other channel is explicitly an
internal draft fixture and is excluded from live SNS verification.

Bounded implementation: a local Python inference CLI under existing `scripts/`
and a server-side adapter under `server/src/services/`, with their focused tests.
Use the saved full checkpoint and its exact questions, local offline loading,
one credential-free observation over stdin, strict three-status/probability
validation and default 0.8 probability gate. Preserve the raw choice separately
from the gated status. Reject truncation, cancellation, malformed output and
process failure as errors, never account deletion or successful synchronization.
Paths are operator-supplied absolute paths; no shell interpolation, raw input in
process arguments, external model fallback, new HTTP service or scheduler.

Live validation: read the existing company/channel configuration through the
authenticated Aside Paperclip tab; delegate a read-only observation of that
selected Naver account to Aside exec. Preserve existing tabs and do not edit,
publish, send, delete, switch accounts, sign out or change security settings.
If authentication is required, record that current state without logging in just
to make the test pass. Compare inference with direct current browser evidence.
Only platform, configured owner identifier and a bounded factual observation
reach the local model; no expected verdict or raw browser transcript does.
The owner identifier was retained to preserve the trained input contract;
redacted-input equivalence was not tested. No credentials or private browser
content enter Git or Hindsight. Any failure/conflict remains visibly unconfirmed.

No production server restart, DB write or deployed route change is requested by
this connection test. The server adapter is exercised from the local checkout
with actual channel configuration and fresh Aside evidence. Report separately
which full chain was run, any account/authentication limitations, whether the
model agreed, and whether the existing production UI uses it (not yet).

The first full live chain returned an actual counterexample: owner controls and
the correct MyBlog redirect were present, but re-navigation to the exact channel
URL hit NavigationReadinessTimeoutError (30000 ms). Aside reported unknown;
Laya incorrectly chose auth_required at 0.8918 (6081 ms cold inference).
An independent current Aside inspection again confirmed owner controls without
an authentication gate. Preserve that report and the model checkpoint; do not
train on or relabel this live evaluation to make it pass. Add a bounded private
observation sidecar and failure-stage diagnostics to the existing live harness
before collecting a second fresh observation. Both reports are evaluation only,
not channel status writes or proof of readiness for automatic synchronization.

Implemented files: `scripts/marketing-laya-inference.py`,
`server/src/services/marketing-laya.ts`,
`server/scripts/marketing-laya-live-check.ts`,
`scripts/test_marketing_laya_inference.py`, and
`server/src/__tests__/marketing-laya.test.ts`.
The live harness belongs to the server package (its existing script layout and
dependencies), not a duplicate root script. It saves a strict-schema observation
sidecar before inference with exclusive creation and file mode 0600. That is a
bounded account-state observation, not a browser transcript. Existing reports
and sidecars cannot be overwritten. Failed phases are named without echoing
input, subprocess diagnostics or secrets. Generated evidence is ignored local
`tmp/marketing-dev/laya-training/` data, not a tracked production asset.

Actual live outcomes on the same configured Naver owner and unchanged checkpoint:

| Fresh Aside observation | Local Laya verdict | Selected probability | Cold inference |
| --- | --- | --- | --- |
| Unknown: owner controls present, re-navigation timeout | auth_required (wrong) | 0.8918 | 6081 ms |
| Connected: owner redirect and controls, no authentication gate or failures | connected (matched) | 0.9621 | 5939 ms |

Both runs executed authenticated Paperclip configuration -> selected Aside
profile observation -> server adapter -> native local Laya inference, with no
input truncation. First failure evidence was recovered from its exact Aside
session and its observation SHA256 matched the original report. An independent
read-only browser inspection also confirmed the owner state. The second fresh
observation contains no failures. Both created and closed one inspection tab and
preserved the pre-existing Paperclip tab. No posting, login, account mutation,
DB writes, training changes, external model API calls or operational restart.
Reports: `tmp/marketing-dev/laya-training/live-check-report.json` and
`live-check-repeat-report.json`, each with a `.observation.json` sidecar.

This is two observations of one real account, not an accuracy estimate or proof
across all platforms/statuses. A navigation timeout can coexist with a valid
signed-in account; the model's high probability is not independent evidence of
authentication failure. Production integration remains deferred: transport and
evidence-conflict checks must preserve existing account configuration/state and
not convert an unconfirmed observation into a login requirement. The live
classifier remains outside the existing deployed UI/polling route.

Validation (all passed):

```sh
PYTHONDONTWRITEBYTECODE=1 /Users/ydy1412/.local/bin/python3.11 -m unittest discover -s scripts -p 'test_marketing_laya*.py' -v
pnpm exec vitest run server/src/__tests__/marketing-laya.test.ts server/src/__tests__/marketing-jev-gateway.test.ts server/src/__tests__/marketing-naver-account.test.ts
pnpm exec tsc --noEmit -p server/tsconfig.json
pnpm --dir server exec tsc --ignoreConfig --noEmit --types node --target es2022 --module nodenext --moduleResolution nodenext --skipLibCheck scripts/marketing-laya-live-check.ts
git diff --check
```

Python: 16 tests; Vitest: 68 tests across 3 files. Server and separate script
type checks passed. No full UI build/deployment was required or performed.
Reproduce from the checkout using a fresh, non-existing output filename:

```sh
pnpm --dir server exec tsx scripts/marketing-laya-live-check.ts "$(pwd)/tmp/marketing-dev/laya-training/live-channel-config.json" "$(pwd)/tmp/marketing-dev/laya-training/live-check-new-report.json"
```

Graphify's existing scoped structural graph was queried and refreshed with the
five relevant implementation/test files, preserving existing graph files. It
does not establish live correctness. Final review confirmed no new dependency,
top-level directory, parallel module, route wiring or unrelated worktree change.

Checklist:
- [x] Confirm canonical checkout, rules, dirty worktree and live profile binding
- [x] Recall project training constraints; query graph and verify current source
- [x] Add local inference and server adapter with strict failure boundaries
- [x] Run Python/server regression tests and server type check
- [x] Observe the real configured Naver account in Aside without publication
- [x] Run the server adapter against fresh evidence and compare observed state
- [x] Reconcile results, limitations and reproducible commands

## Local Laya training (2026-10-07)

Requested: generate varied synthetic Aside channel observations and expected
answers with GPT-6 Luna, retain inspectable CSV, and actually fine-tune local
Laya. This is an offline pilot, not a deployed classifier, real-account data
capture, publication, or permission to auto-delete accounts.

Use existing `scripts/` for reproducible dataset validation/training and ignored
`tmp/marketing-dev/laya-training/` for generated data, a dedicated Python 3.11
environment, downloaded weights, reports and checkpoints. The existing
`decision-training` service captures Paperclip issue decisions; it is not this
synthetic channel classifier and will not be modified or populated.

Dataset contract: platform, synthetic accountId, observation, expected status,
family ID, split and rationale. Statuses match the current Jev contract:
`connected`, `auth_required`, `unknown`. Transport failure, stale evidence,
wrong-owner evidence and conflicts never establish an absent/deleted account.
All rows and labels are synthetic Luna outputs, not verified SNS ground truth.
No real credentials, account identifiers, private observations or transcripts.
Initial target 360 rows: 216 train / 72 calibration / 72 test, with disjoint scenario
families and no normalized exact duplicates across splits. Review labels and
reject malformed data before training; do not silently repair observations.

Use `laya-multilingual` and official `laya.train.train_model` with RLCD, a frozen
encoder for the first memory-bounded pilot, fixed seed, and local MPS or CPU.
Keep the existing base checkpoint untouched. Separate calibration and test
data from training, fit temperature on calibration only, and compare the same
held-out synthetic test before/after: accuracy, macro F1, confusion matrix,
false-connected rate and probability calibration. No production promotion on
synthetic metrics alone. Real Aside validation remains a separate requirement.
Use the lower-level official training and calibration functions rather than the
convenience `finetune` wrapper: that wrapper writes duplicate full checkpoints
each epoch and automatically slices individual rows, while this pilot has
explicit family-isolated calibration data and initially about 3.5 GiB disk free.
Pin the downloaded upstream revision and save just one final checkpoint.

First frozen-encoder pilot finished: 6 RLCD epochs on 216 rows, with sampled
head weights changed and saved-checkpoint reload evaluated. Its exploratory
test accuracy regressed from 30/72 to 29/72. It was not promoted. The second run used
full-encoder RLCD with micro-batch 1, accumulation 16 and activation checkpointing
on MPS. The first checkpoint/report was preserved. Since the original test had
been observed during development, Luna generated an additional independent
`final-test.csv` (72 cases, 24 per label). It was used only after the full candidate
was fixed; no candidate or threshold selection from this final set. Its synthetic
labels still cannot establish actual Aside integration accuracy.

Completed corpus: 432 Luna-authored observation/expected-answer/rationale rows:
216 training, 72 calibration, 72 exploratory test and 72 final test. Each split
is label-balanced with disjoint family IDs and no normalized exact duplicates.
Parent validation caught malformed CSV, incorrect label counts and unsupported
synthetic ID punctuation; the Luna workers corrected these before their data
was consumed. Final-test corrections changed ID punctuation/CSV serialization,
not expected labels or case meanings. The model was already saved before any
final evaluation. A textual similarity audit found no train/exploratory-holdout
pair at SequenceMatcher ratio >= 0.80; this is not semantic independence proof.

Actual results, measured after reloading saved checkpoints:

| Evaluation | Base correct | Trained correct | Trained macro F1 |
| --- | --- | --- | --- |
| Frozen-encoder exploratory pilot | 30/72 (41.67%) | 29/72 (40.28%) | 0.3132 |
| Full-encoder exploratory test | 30/72 (41.67%) | 58/72 (80.56%) | 0.8073 |
| Full-encoder final test | 26/72 (36.11%) | 61/72 (84.72%) | 0.8468 |

Full RLCD run: 6 epochs, seed 42, MPS, micro-batch 1, accumulation 16,
encoder LR 0.000025, head LR 0.0002, activation checkpointing, input budget
512 tokens / question budget 160. Inputs exceeding the budget are rejected,
not truncated. Sampled head maximum weight change was 0.00508588; saved fp16
checkpoint predictions matched the in-memory model on the exploratory set.
Training plus exploratory evaluation/export took 767.69 seconds. Installed
versions: Python 3.11.15, Laya 0.3.28, Torch 2.14.1, Transformers 5.18.0.
Base revision: `1720e3e3357cfe1e281542e223f8273b0890ca34`.

Final confusion matrix, rows/columns connected, auth_required, unknown:
`[[19,1,4],[1,22,1],[2,2,20]]`. Three of 48 non-connected cases were falsely
called connected (6.25%, versus base 4.17%). Final ECE was 0.0873, NLL 0.4488,
and Brier score 0.2391. Calibration used only its own 72 cases; fitted choice
temperature hit the upper clamp of 5. Do not treat probabilities or synthetic
accuracy as a live guarantee. No final-set tuning or production promotion.

Generated outputs under `tmp/marketing-dev/laya-training/`:
- `luna-channel-observations.csv`: all 432 rows, UTF-8 BOM, labels and rationale
- `dataset-manifest.json`: counts, families and per-split SHA-256 hashes
- `train.jsonl`, `calibration.jsonl`, `test.jsonl`, `final_test.jsonl`
- `rlcd-pilot/` and `rlcd-pilot-report.json`: preserved failed first pilot
- `rlcd-full/` and `rlcd-full-report.json`: full trained checkpoint and config
- `rlcd-full-final-report.json`: separate final evaluation and weight hashes
- Worker provenance JSON files: generation scope/model and correction history

Reproduction commands from the canonical repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 /Users/ydy1412/.local/bin/python3.11 -m unittest discover -s scripts -p test_marketing_laya_training.py -v
PYTHONDONTWRITEBYTECODE=1 tmp/marketing-dev/laya-training/.venv/bin/python scripts/marketing-laya-training.py --dataset tmp/marketing-dev/laya-training --base tmp/marketing-dev/laya-training/hf-cache/models--convaiinnovations--laya-multilingual/snapshots/1720e3e3357cfe1e281542e223f8273b0890ca34 --device mps --output rlcd-full --epochs 6 --full-encoder
PYTHONDONTWRITEBYTECODE=1 tmp/marketing-dev/laya-training/.venv/bin/python scripts/marketing-laya-training.py --dataset tmp/marketing-dev/laya-training --base tmp/marketing-dev/laya-training/hf-cache/models--convaiinnovations--laya-multilingual/snapshots/1720e3e3357cfe1e281542e223f8273b0890ca34 --device mps --output rlcd-full --evaluate-final-only
```

The training command refuses an existing output directory; use a new output
name for reproduction, never overwrite the preserved checkpoint. The final
command only evaluates; it never trains on final cases. Ten Python regression
tests, syntax checks and `git diff --check` passed. Scoped source graph refreshed:
26 files, 269 nodes / 424 edges, with 786 external/dangling raw edges excluded.
No application source, schema, lockfile, service or deployment was changed by
this pilot; full application builds and browser tests were not applicable.
Paperclip issue upload was not performed: this desktop run has no bound issue
credentials. Generated weights/data remain local ignored temporary artifacts,
not a durable backup. Next boundary: operator-reviewed real Aside observations,
misclassification analysis and production threshold validation before any
classifier integration. Do not retrain or select a threshold on this final set.

Selective Hindsight record saved after local validation in the newly created
project bank `codex-paperclip-knowledge-current-c75f2d8147d9`, document
`marketing-laya-offline-pilot-2026-10-07`. A read-back caught extraction associating
final-test false-connected errors with calibration; the non-destructive dated
correction `marketing-laya-final-evaluation-correction-2026-10-07` supersedes
that attribution. Correction read-back confirmed base 26/72, trained 61/72,
final-test 3/48 false-connected, and the synthetic-only/no-deployment boundary.
Only concise verified outcomes/lessons were stored, not fixtures or weights.

Execution checklist:
- [x] Resolve canonical repo, preserve dirty changes, read local rules/docs
- [x] Hindsight project bank absent at kickoff; scoped graph queried and source verified
- [x] Generate Luna-labelled CSV with disjoint train/calibration/test families
- [x] Validate corpus and run dataset pipeline regression tests
- [x] Install isolated runtime and measure base checkpoint
- [x] Run RLCD pilot, save checkpoint, independently evaluate before/after
- [x] Evaluate fixed full checkpoint on an additional sealed 72-case final set
- [x] Reconcile documentation with actual metrics and limitations
- [x] Selectively retain verified project outcomes and confirm corrected read-back

Public contracts checked: https://github.com/NandhaKishorM/laya#fine-tuning and
https://github.com/NandhaKishorM/laya/blob/main/laya/train.py . Hardware observed:
Apple M4, 16 GiB RAM. No model weights or synthetic rows go into Hindsight.

## Jev Gateway adapter (current bounded request)

Aside owns SNS registration and supplies observations; Paperclip will eventually
project that information locally. The current request is only a server-side Jev
adapter for classifying one channel observation, not registration, browser
discovery, polling, persistence, UI changes, deployment or publication.

Use the existing `server/src/services/` and `server/src/__tests__/` layout.
`classifyMarketingChannelObservation` accepts the known platform, account ID and
a bounded, credential-free observation from Aside. It requests one Choice:
`connected`, `auth_required`, or `unknown`. It does not extract identities or
decide publication success. Return the original choice, its probabilities and
the effective status; a selected probability below the configurable threshold
(default 0.8, not yet calibrated on live examples) yields `unknown`.

Use built-in fetch and existing Zod, without a new SDK/dependency:
`POST https://ai-gateway.vercel.sh/v1/evaluate`, model `typesafe-ai/jev`, bearer
`AI_GATEWAY_API_KEY`. Require zero data retention and the TypeSafe provider only.
One request, 15-second deadline including response consumption, optional caller
cancellation, no automatic retry/fallback. Validate the choice, all three finite
probabilities and their sum, plus the documented camelCase token usage. Accept
additional provider metadata without storing or exposing it. Never log the key,
observation, raw provider error body or underlying network exception. Failures
are errors, not successful `unknown` classifications. No credentials or full
Aside transcripts should be passed to this function.

Official contract checked on 2026-10-06:
- https://vercel.com/docs/ai-gateway/modalities/decision
- https://vercel.com/changelog/ai-gateway-now-supports-typesafe-clients-and-http-api-for-jev

Execution checklist:
- [x] Confirm canonical checkout and preserve existing dirty worktree
- [x] Check Hindsight project bank (absent), query existing scoped Graphify graph
- [x] Verify native Gateway HTTP request and response against official docs
- [x] Implement the focused adapter and deterministic HTTP-contract tests
- [x] Run tests, type checks, final diff review and reconcile this document
- [x] Attempt live Gateway check with an operator-provided key; authentication verified, inference blocked by plan gates
- [ ] Successful live Jev classification of the three synthetic examples

Implemented in `server/src/services/marketing-jev-gateway.ts`, with 40 adapter
tests in `server/src/__tests__/marketing-jev-gateway.test.ts`. Configuration reads
`AI_GATEWAY_API_KEY` at invocation or accepts an explicit server-side key. Only
the validated input fields leave the server; raw metadata is not returned.
Choice probability is not labeled TypeSafe confidence. Malformed/contradictory
responses, transport errors, HTTP errors, cancellation and body-read deadlines
are explicit sanitized errors. No new dependency, environment file, DB schema,
route, scheduler, account modification, service restart or deployment was added.

Usage from a future trusted server-side synchronization caller:

```ts
import { classifyMarketingChannelObservation } from "./marketing-jev-gateway.js";

const decision = await classifyMarketingChannelObservation({
  platform: "naver_blog",
  accountId: channel.accountId,
  observation: credentialFreeAsideObservation,
});
// decision.status, choice, probability, probabilities, model and usage
```

Validation on 2026-10-06:
- `pnpm exec vitest run server/src/__tests__/marketing-jev-gateway.test.ts server/src/__tests__/marketing-aside-profiles.test.ts server/src/__tests__/marketing-aside-session.test.ts`: 54 tests passed in three files (40 new adapter cases).
- `pnpm exec tsc --noEmit -p server/tsconfig.json`: passed.
- `git diff --check`: passed; existing Vite config-loader warning remains.
- Hindsight project bank checked and absent; no memory written. Existing graph
  queried for Aside transport/profile dependencies, then extended with just this
  source module: 24 files, 243 nodes / 378 edges; 767 raw external/dangling edges
  remain outside the scope. Source and official HTTP documentation are authority.
- At initial implementation time no Gateway key existed in the process
  environment and no live API call had been made. The subsequent authorized
  live attempt is recorded below. Mock tests do not establish Jev's semantic
  accuracy or live account state. The threshold awaits real-example calibration.

### Authorized live check (2026-10-06 follow-up)

Read only `AI_GATEWAY_API_KEY` from the existing private native instance `.env`;
no key value is recorded here, in code, Git or output. Native source adapter was
invoked from the server workspace with three planned Korean synthetic examples
(connected, login required, unknown), not real Aside observations or SNS data.
Execution stopped at the first rejected example; no successful model answer or
classification accuracy is claimed.

Observed results:
- Original adapter request: HTTP 403. A separate sanitized diagnostic identified
  the explicit ZDR entitlement error: current plan is Hobby; ZDR requires Pro or
  Enterprise. This is a constraint introduced by the adapter's selected default,
  not a requested product requirement. Production policy was not changed.
- `GET /v1/credits`: HTTP 200, key authenticated, a positive balance present.
  No exact balance or account identifiers retained in this document.
- `GET /v1/models`: HTTP 200 and `typesafe-ai/jev` listed. Catalogue presence
  does not establish permission to run that model.
- Synthetic-only diagnostic transport omitted ZDR for the fixed fake owner and
  fixture text, without changing the source adapter, runtime settings or any
  real-data caller. This also returned HTTP 403. Its sanitized error was
  `no_providers_available`: free-tier users have no access to this model and must
  move to paid Gateway credits. Authentication success is not model entitlement.

Different authorized alternatives investigated:
1. Original native Decision API with ZDR: actually attempted; Hobby plan gate.
2. Native Decision API without ZDR for synthetic diagnostics only: actually
   attempted; separate free-tier Jev access gate. Not a successful adapter run.
3. Official TypeSafe-compatible API: documentation reviewed; same Gateway auth
   and billing, not a separate entitlement or a way around the restriction.
   No alternate-protocol inference call was made after the access gate was known.

No credit purchase, plan upgrade, account switch, provider fallback, production
privacy-policy change, service restart or deployment was performed. Remaining
inputs are operator-enabled paid Jev access and an explicit operating decision
about the optional ZDR policy (retain it with an eligible plan, or intentionally
choose the normal mode for credential-free status observations). Repeat the
three live fixtures only after those prerequisites are resolved.

Official references checked during diagnosis:
- https://vercel.com/docs/ai-gateway/security-and-compliance/zdr
- https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe

## Current goal (user revised)

Latest revision: publication is a common Aside agent request, not an application
implementation of each SNS editor. All registered platforms and approved native
image/video attachments are eligible for delegation. Exact operator approval
queues and requests only those jobs immediately; do not drain unrelated queued
jobs. Aside uses the selected account/profile, checks the actual destination
owner, preserves approved content/media, posts once, then reports native session
evidence and the permalink. Unsupported editor limits/login/upload failures are
task outcomes, not hard-coded platform exclusions. No unapproved live test post.

Existing local-disk approved attachments are handed off as verified read-only
file paths, SHA-256/size/MIME/alt and authenticated attachment URLs; validate
ownership, root containment and exact bytes before requesting. No new public
download endpoint, shared credentials, permission changes or temporary database.
Nonlocal attachments retain authenticated source URLs; Aside must obtain and
verify them before posting, otherwise stop without silently dropping media.

Completion still requires a terminal native Aside session and exact structured
result. Keep independent native article checks for legacy text-only Naver
receipts. Common delegation receipts explicitly report observed owner/text,
approved uploaded media identities and actual creation time; validate them in
trusted code. This is Aside-reported browser evidence, not independent platform
API verification. Missing/mismatched evidence remains uncertain, never success.
Reconciliation only observes the saved session, never publishes again. Earlier
text-only/platform restrictions below are historical and superseded by this
revision. Validate common request payload/media, selected dispatch isolation,
receipt mismatch handling and operator approval; deploy only scoped files.

Implementation evidence for this latest revision:
- [x] All seven registered platform types delegate through the same native Aside session
- [x] Exact approved body/media/account/profile payload and verified local file handoff
- [x] Approval requests only its selected jobs; unrelated approved queues stay untouched
- [x] Native result validation, uncertain-state protection and no blind replay
- [x] Operating media Publish and approval dialog verified without submitting
- [ ] Real publication and result evidence for each connected account

`marketingAsidePublicationPrompt`/`marketingAsideMedia` extend the existing
transport module, not a second platform subsystem. Existing authorized local
storage is read-only: company ownership, canonical root containment, size and
SHA-256 are verified before local paths are passed to Aside. Original URLs are
authenticated; no tokens or new public endpoint. Native observed-result JSON
must match job/hash, actual owner, full title/body, ordered file identities and
creation time. Legacy text-only Naver receipts retain independent article checks.
Common reports are explicitly labeled `native_aside_report`; they are delegated
browser reports, not independently verified platform API receipts. Login failure
must explicitly report no submit started. For non-Naver failures, a site login
does not globally block the unrelated SNS channels on that profile; retry remains
operator initiated. The legacy Naver account-check unblock flow is preserved.

UI approval now says `승인하고 Aside에 발행 요청`; queue creation is followed by
dispatch with only returned job IDs. Existing explicit whole-project execution
is still available for deliberate queue processing. `/marketing/dispatch`
accepts optional 1-50 UUID job IDs, company/project scoped, matching the existing
50-draft approval maximum. Missing selection/invalid IDs never bypass execution
locks. No scheduler, auto-approval or unapproved test publication was added.

Native PostgreSQL and component tests cover all platform delegation types,
image/video original handoff, changed bytes preventing execution, receipt owner/
body/media/time mismatches, login failure and selected-only dispatch. UI typecheck,
server TypeScript emit, UI build, token gates and whitespace validation pass;
existing Vite/CSS/chunk warnings remain. Real operating original PNG/MP4 bytes
were also read-only checked (four references across two drafts), all size/hash
matches. These checks do not claim a real media upload to an SNS site.
Final focused run passes 122 tests in six files: `pnpm exec vitest run
server/src/__tests__/marketing-aside-transport.test.ts
server/src/__tests__/marketing-dispatch.test.ts
server/src/__tests__/marketing-service.test.ts
server/src/__tests__/marketing-publication.test.ts
server/src/__tests__/marketing-aside-session.test.ts ui/src/pages/Marketing.test.tsx`.
The selected-ID API case permits the existing unresolved-job 409 lock outcome
after validation rather than bypassing it. No full repository suite is claimed.

Scoped deployment uses `publication-followup-apply.mjs --aside-request` and
restricted `production-backup/aside-request/runtime-before.tgz`, restoring only
four server modules and UI assets on rollback. Instance environment backup is
restricted; no env, DB, auth/permissions or launchd config changed for this
revision. Native jobs were idle before applying/restarting; candidate manifest
was updated. A route-only follow-up aligns dispatch's maximum to 50, with the
same original rollback archive and reconciled hashes.
Final native restart passed health with PID 3070 and no lost/adopted agent runs.
Operating API reports all seven platform types and media eligible for delegation,
zero jobs, unchanged real draft revisions 4/1 and two attachments each. u1 Aside
opened the actual media approval dialog, verified the button and both attachment
names, then cancelled; no execution request was sent. Screenshot:
`/Users/ydy1412/.aside/u/1/sessions/2026-10-06_TcMDk9SPwnzz0c7O/artifacts/aside-publication-request-approval.png`.
Live platform editor/upload limits, permitted filesystem access and account
login remain runtime prerequisites, not asserted as already exercised. Actual
LinkedIn/Instagram account URLs remain pending operator input.

Reused the absent project Hindsight bank finding; no memory writes. Refreshed
the same code-only Graphify scope: 23 files, 233 nodes / 369 edges (764 raw
external/dangling endpoints). Current source and actual operating browser/API
checks, not graph inference, ground the implementation.

Publication follow-up (user approved): expose an active-draft Publish command
with explicit revision/content/channel/account/media approval, channel status
dots and an approved-job-only Aside layout directly below the Profile/Channel
buttons. Reuse the existing immutable queue and sequential dispatch, native
session persistence, reconciliation and safe-retry boundaries. No unattended
schedule or test publication is authorized by this implementation request.
The existing native transport supports only text-only Naver posts: expose actual
capabilities and explain unsupported media/platforms before approval, rather than
silently dropping attachments or pretending all channels are ready. Default
instances remain draft-only; explicitly enable the operating instance through
`PAPERCLIP_MARKETING_PUBLICATION_ENABLED=true` after scoped validation.
Use the existing approval/dispatch steps: Publish opens approval, approval queues
the exact revision, and the operator explicitly runs the project queue. Show
latest channel job/title/time/error/permalink and persisted Aside session ID,
not inferred success from an idle session. Active/unresolved jobs take priority
over historical success; all project channels remain visible in the tree,
but only approved jobs appear below the buttons. Keep drafts editable while
status polling runs.

Publication follow-up checklist (reuse the approved four items):
- [x] 기존 초안 작성·검토 기능 운영 반영
- [x] 발행 버튼과 사용자 승인 흐름 연결
- [x] 프로필·채널 버튼 아래 채널별 Aside 발행 상태 표시
- [ ] 실제 발행·게시물 링크 확인

Provide drafting tools to any same-company agent assigned to the project task,
without a hard-coded agent identity. Use `marketer staff_1` (`codex_local`,
`gpt-6-luna`) only as the live test actor. The agent creates channel-specific
publication-ready drafts including native image/video attachments; the operator
can see and edit them in the Marketing menu. Codex implements tools and validates
the integration, not the marketing copy in place of that agent. Autonomous Aside
posting was outside the original draft milestone. The publication follow-up
above supersedes that restriction only for an explicit operator-approved queue;
unapproved test publication and unattended scheduling remain excluded.

## Publication follow-up implementation and evidence

### Channel status presentation revision

User revised the layout: channel names in the project tree carry one small
red/orange/green dot, with a readable tooltip and accessible status name.
Queued/publishing are orange; verified publication is green; failed,
auth-required and uncertain are red. Channels with no approved publication job
have no dot; cancelled jobs do not imply failure or readiness. Preserve
unresolved publishing/uncertain priority. Below Profile/Channel, show only real
approved publication jobs, not all registered channels or no-history rows.
Hide that job panel when no jobs exist; never fabricate jobs for demonstration.
Keep five-second status polling isolated from unsaved editing.

LinkedIn and Instagram already exist in platform validation and account URL
checks. Expose explicit creation entries in the Channel menu and preselect the
chosen platform in the existing form. Actual registered channels require the
operator's account URL; do not invent accounts or treat platform registration
as verified publication support. Existing transport remains text-only Naver.
Validate dot colors/status tooltips, empty panel removal, queued-only records,
editing preservation, platform form selection and existing regression cases
before scoped UI-only deployment. No backend, DB or permission change needed.

Implemented and deployed this revision. `MarketingPublicationDot` uses fixed
8px circles with CSS token colors (orange/green/red), native hover titles and
accessible status labels beside channel names. Cancelled approvals are excluded
from dots and the lower panel. The lower panel lists approved jobs only and is
absent when no jobs exist, except an explicit status-fetch error. Unresolved
work takes priority; registered but unused channels do not appear in the panel.
The existing Channel button now opens platform choices, including LinkedIn and
Instagram, then the existing form preselects that platform with a default name
and blank account fields. No synthetic operating accounts were created.

Validation: `pnpm exec vitest run ui/src/pages/Marketing.test.tsx` passed 41
tests, including six dot states/tooltip labels, no-history and cancelled removal,
unsaved-content preservation, and both platform menu/form flows. UI typecheck,
build, token gates and `git diff --check` passed. Existing build warnings remain.
Applied static UI only after restricted backup to
`tmp/marketing-dev/production-backup/publication-dots/ui-before.tgz`; updated
derived candidate UI assets too. No restart, schema/auth/permission or service
flag change. Rollback restores that UI-only archive to installed node_modules.

Operating u1 Aside inspection confirmed no-history panel and dots are absent
with zero real jobs. It opened LinkedIn and Instagram forms, verified selected
platforms and blank account URLs, then cancelled without saving. At 1485px there
was no horizontal overflow; screenshot:
`/Users/ydy1412/.aside/u/1/sessions/2026-10-06_6orbP9Pp4llpmuxK/artifacts/marketing-channel-status-revised.png`.
Authenticated overview still reports two original channels, zero jobs and the
unchanged text-only Naver capability. Dot colors/nonempty jobs were validated
in local component tests, not fabricated native data or an actual publication.
Actual LinkedIn/Instagram account registration is pending operator account URLs;
their browser publication transports and Naver media publishing remain absent.
Mobile/dark-mode live verification was not performed for this revision.

Reused the prior absent Hindsight-bank finding and queried/refreshed the same
Graphify scope (23 source files, 230 nodes / 362 edges). Current source and native
browser inspection were the implementation authority, not historical memory or
graph-only claims. No memories or hooks were added.

Implemented active-draft Publish and exact revision approval in
`ui/src/pages/Marketing.tsx`; approval queues only, and the separate project
queue execution still requires explicit confirmation. Publication controls fail
closed when enablement/capabilities are missing. Unsupported platforms/media
are also rejected inside the native queue transaction; draft-only instances
reject queue approval. Existing agents cannot approve or dispatch.

`ui/src/components/MarketingPublicationStatus.tsx` sits immediately below the
Profile/Channel buttons. It shows all selected-project channels, regardless of
the selected profile/channel, and prioritizes publishing/uncertain jobs over
newer historical results. Job status, revision, update time, errors, native
session ID and verified permalink are shown when recorded. No history is not
a browser connection/ready claim. Separate five-second overview polling updates
this panel without replacing unsaved editor state; authorization failures hide
cached status rather than displaying it as current. Status colors use existing
CSS tokens, with blue/green/red and explicit text labels.

The native transport now advertises `{ platforms: ["naver_blog"], media: false }`.
`server/src/app.ts` remains draft-only by default and enables it only through
`PAPERCLIP_MARKETING_PUBLICATION_ENABLED=true`. No new schema or scheduler.
Media uploads and other SNS transport implementations remain unimplemented;
the existing two real agent drafts retain their PNG/MP4 attachments and revisions
4/1, so their Publish commands are intentionally disabled. No attachments were
dropped and no test post was sent externally.

Production-compatible checks passed: 85 tests across Marketing UI/service/
dispatch/publication/Aside transport, plus 12 native Aside session tests (97
total). Commands: `pnpm exec vitest run ui/src/pages/Marketing.test.tsx
server/src/__tests__/marketing-service.test.ts server/src/__tests__/marketing-dispatch.test.ts
server/src/__tests__/marketing-aside-transport.test.ts server/src/__tests__/marketing-publication.test.ts`
and `pnpm exec vitest run server/src/__tests__/marketing-aside-session.test.ts`.
Shared build, server `pnpm exec tsc -p server/tsconfig.json`, UI typecheck/build,
token gates and whitespace check passed. Existing Vite/CSS/chunk warnings remain;
no full repository suite or mobile viewport verification is claimed.

Scoped operating overlay: `tmp/marketing-dev/publication-followup-apply.mjs`
backs up five server modules, UI assets and the instance environment under
restricted `tmp/marketing-dev/production-backup/publication-followup/`. An initial
archive attempt failed because tar interpreted leading `@` names as list files;
no installed file had changed. Explicit `./` paths corrected this, and the backup
completed before applying. Native agent/plugin/publication jobs were idle;
config and launchd plist hashes remain unchanged. The explicit flag was enabled
in the existing instance environment, and native service restart passed health
with PID 70592. The derived candidate manifest was reconciled.
Rollback: restore that archive into the installed node_modules directory,
restore the restricted `instance.env` backup to the instance `.env`, and restart
the native service. No database rollback is needed.

Authenticated operating API returned enabled true, text-only Naver capabilities,
zero publication jobs and unchanged draft revisions/media. u1 Aside browser
inspection confirmed both channel statuses below the buttons, unsupported SNS
label and disabled media Publish with its reason. At 1485px viewport there was
no document-level horizontal overflow; captured image:
`/Users/ydy1412/.aside/u/1/sessions/2026-10-06_ywnYUJv7hBPglGxj/artifacts/marketing-publication-status.png`.
Real approval dialog/dispatch/publication was not exercised on operating content;
approval and dispatch boundaries are covered by local tests, not a live post.

Context retrieval: repository-specific Hindsight bank was absent; no bank/memory
was created. Existing Graphify initially lacked dispatch/transport nodes, so
current source guided the change. Refreshed the same scoped output with 23
source files: 228 nodes / 357 edges, AST only, no paid semantic extraction.
The resulting query traces dispatcher publish/reconcile and transport boundaries;
749 external/dangling raw endpoints remain outside this scope.

## Original requirements (posting scope superseded)

Canonical root: `/tmp/paperclip-knowledge-current`. Preserve existing Knowledge,
artifact, CLI and runtime work. Operating core remains the installed 2026.1001.0
baseline until a compatible candidate has been tested; do not deploy the entire
current checkout over that instance.

- M1: Marketing sidebar opens company-scoped project > browser profile > SNS
  channel hierarchy. Reuse existing projects. A channel is a durable SNS account;
  its browser profile is a replaceable access binding, not the channel identity.
- M2: Store channel concept, tone, audience and writing rules. Generate separate
  drafts for selected channels from one topic; support editable text, native
  image/video attachments and preview. Generated content never authorizes posting.
- M3: A board user can queue one or many exact draft revisions. Persist immutable
  body/media/channel/account/profile snapshots. Edits invalidate pending approval;
  already executing/uncertain jobs cannot be silently replaced or replayed.
- M4: Aside traverses explicitly selected profiles sequentially. Verify the logged
  in SNS account before posting; verify actual posted content and canonical URL
  before marking published. No inferred success from CLI exit code or button click.
- M5: Authentication blocks only its profile. Continue other eligible profiles.
  Uncertain posting requires read-only reconciliation, never blind retry. Persist
  attempts, errors and evidence; operator can inspect and resume safely.

## Technical plan

The operating router is draft-only by default: no publication transport is
constructed unless explicitly injected. Overview reports `publicationEnabled:
false`; the UI hides publication commands and dispatch/retry/reconcile return
409. Existing publication code remains historical, not enabled operating scope.
The installed-version candidate reuses the existing production-compatible build
and preserves Knowledge/artifact overlays. Its additive migration is
`0285_marketing_drafts`, not the newer checkout's 0296/0297 migrations. A small
dedicated-connection export supports the retained dispatch module without
replacing the installed database retry behavior.

### Current validation (2026-10-06)

The production-compatible candidate passed 61 tests across
`server/src/__tests__/marketing-service.test.ts`,
`server/src/__tests__/marketing-publication.test.ts`, and
`ui/src/pages/Marketing.test.tsx`. These are local tests, not operating deployment
or real marketer/media submission evidence. The project-specific Hindsight bank
`codex-paperclip-knowledge-current-c75f2d8147d9` was absent on list-banks lookup;
no bank was created. The existing source-only Graphify index is being extended
with affected Marketing source files; local documents remain authoritative.

The source-only Graphify index now covers 18 selected files (187 nodes, 261
edges). `graphify query 'marketing draft media' --budget 1000` found the draft
screen/editor and media-byte verifier. The extractor reported 447 unresolved
external endpoints, so this is scoped structural evidence, not a complete call
graph. No semantic extraction, answer-memory save or new memory bank was used.

Final installed-version candidate checks passed: DB/shared builds, server
TypeScript emit, UI TypeScript check and Vite build. Existing Vite/CSS/chunk
warnings remain. Knowledge and Artifacts UI tests passed 26 cases; native
`server/src/__tests__/company-artifacts-service.test.ts` passed 12 cases. Together
with the Marketing tests, 99 applicable cases passed. An attempted artifact-folder
test path was absent in this baseline and is not counted as executed coverage.

`tmp/marketing-dev/runtime-prepare.mjs` creates the derived installed-layout
candidate using native package dependencies and a 20-file scoped overlay. It
verifies the old migration journal is an exact prefix and adds only 0285. A first
runtime import exposed a missing `dist/types/marketing.js`; that file was added
to the overlay. The regenerated candidate successfully imports `createApp`,
`marketingRoutes`, and `withDedicatedDbConnection` through the installed layout.
This does not yet prove startup, operating deployment or live agent execution.
Operating files and database remain unchanged by this candidate preparation.

Operating application uses `tmp/marketing-dev/runtime-apply.mjs`: verify idle
native runs, exact candidate file hashes and only 0285 pending; capture a restricted
DB dump plus current UI/server-file archive and config/service hashes before
mutation. Apply the additive migration and scoped files, then native service
restart. Verify authenticated overview, no publication transport, Knowledge and
Artifacts API, and unchanged identities/config/service environment. `--rollback`
restores the owned file archive; the additive tables remain compatible and no
existing records are removed. No plugin reinstall or authentication change.

Operating overlay applied successfully on 2026-10-06. Restricted backup and
verification are under `tmp/marketing-dev/production-backup`; the native API
verified identities/config/service plist unchanged, Hindsight ready and Artifacts
available. Aside u1 rendered the existing Knowledge screen and the new Marketing
menu, then the project/profile/two-channel hierarchy. External dispatch is off.

Live marketer test Task DOB-23 (`df292127-130f-4ec0-bad9-5975c8b7ec35`) was created
in project `6480d5f8-d0c3-4706-a8b2-a09ad5180b11`. Naver uses the previously
verified account binding; the Threads channel is explicitly internal test data,
not a verified SNS account or publication target. The first run failed before
provider dispatch: native worktree provisioning placed its isolated directory
under the original checkout in the user home, whose ancestor Codex provider
configuration conflicts with managed AI authentication. Read-only checks of
agent args/environment, project environment, and actual execution-workspace
ancestors isolated this cause. Do not change global provider config or auth gates.
Retry the same task with isolated worktrees in the existing repository's
`tmp/marketing-dev/agent-worktrees` through native task workspace settings.

The earlier task reused its prior worktree despite clearing its binding. A fresh
native task DOB-24 (`3f73f3a5-1026-47cf-a59e-e2d5cf5aeeb0`) with explicit isolated
workspace settings provisioned under the intended repository-owned path.
Run `9a179167-7aaf-4f52-b03d-94e7f64328d3` reached the provider. Native run-log seq
66/67 recorded reading the mounted `marketing-drafts--028b57dfc2/SKILL.md` and
completed the tool call. This proves live skill loading, not draft/media completion.

DOB-24's first provider turn ended without drafts: injected API URL selected the
unreachable old LAN address from the existing allowed-hostname list. Agent curl
and task-status calls failed to connect; ffmpeg lacked drawtext. Keep existing
authentication and hostname policy unchanged. Set the native instance `.env`
`PAPERCLIP_API_URL=http://127.0.0.1:3100` for local runtime API delivery after a
restricted backup, then restart only while runs are idle. This changes internal
API routing, not external exposure or access permissions. Existing native sharp
`dist/index.cjs` was verified to support SVG buffers for the agent's own media.

Native instance API routing was set to loopback and service restart passed health
checks. A comparison against the restricted `.env` backup confirmed all existing
secret/environment bindings unchanged; only the non-secret local API routing
binding was added. DOB-24 instructions now clarify company versus project IDs
and the verified sharp entry. A task wakeup is scheduled through the existing
native retry system; do not create another run while that handle is pending.

Retry run `a8ec6d3a-a96f-4c91-94a4-aeae31e91f9c` reached terminal `succeeded`
but its actual report says the injected loopback connection still failed with
curl 7. This is provider-turn completion, not task success. Host-side native API
and server listener remain available; agent-context transport requires further
diagnosis without weakening sandbox/auth policies. No new run was launched after
this failure. Agent-produced `tmp/marketing-dev/agent-media/workflow.png` was
visually inspected; the actual MP4 was verified by ffprobe as H.264, 1080x1080,
3 seconds, 195602 bytes. Neither file is uploaded, no draft exists and all
media-submission/real-writing/review checkboxes remain unchecked.

The transport failure is reproduced at the ACP dependency boundary: native run
events report `PAPERCLIP_RUNNER_NETWORK_ACCESS=enabled` and
`PAPERCLIP_CODEX_ACP_NETWORK_ACCESS=true`, but installed codex-acp 1.13.1 has
unpatched workspace-write mode presets (`networkAccess:false`). Repository patch
`patches/@agentclientprotocol__codex-acp@1.6.2.patch` already defines the intended
policy projection; the installed newer dependency does not contain it. Port only
that policy projection to an owned 1.13.1 candidate, test default/explicit denial
and allowed cases, back up the installed file, and apply while idle. Preserve
workspace-write restrictions, approval policy, explicit network denial and all
provider credentials. No full-access mode, global provider configuration, package
version replacement or permission widening is introduced.

Seven policy regression tests failed on the unpatched 1.13.1 candidate and passed
after the minimal projection port; syntax check passed. Tests cover unspecified
and invalid flags, adapter denial, execution-target denial, preserved filesystem
roots/policy, non-workspace policies and unchanged turn approval behavior. The
installed dependency was backed up with before/after SHA256, updated while native
runs were idle, and the service restarted to discard warm old ACP processes.
Owned artifacts: `tmp/marketing-dev/codex-acp-network.test.mjs`, candidate JS,
and `production-backup/codex-acp-patch.json`. Restore the restricted before-file
and restart to undo this dependency-only change. A reinstall may overwrite this
operating-package port; do not claim it is part of a published upstream release.

Run `a1a86811-5d5a-45ad-8d78-dc1d16184b70` verified channel-context HTTP 200
after the port and began native uploads. The first MP4 multipart upload reported
application/octet-stream; do not count it as a video attachment or weaken the
media validator. Clarify explicit multipart MIME (video/mp4/image/png) and company
versus project ID in the reusable skill, publish that version through the native
company skill API, and have the agent upload the real video with its correct type.

### Operating completion evidence (2026-10-06)

Native run `a1a86811-5d5a-45ad-8d78-dc1d16184b70` is `succeeded`; DOB-24 is
`done`, assigned to `marketer staff_1`, live configuration `codex_local` /
`gpt-6-luna`. The run read the mounted marketing skill, retrieved channel rules,
authored two different Korean drafts, generated `agent-media/draft-review.png`
and `draft-review.mp4`, uploaded them, and submitted both through draft-tools.
Its native agent-authored comment `725fc7f1-427b-4ce3-bbf9-4f79bbb9f677`
records both drafts and media IDs. Codex did not author or submit these drafts.

- Naver draft: `4f3a5393-1394-4f59-adc4-87f2c0c9a911`, 767-character body.
- Internal SNS draft: `a888f818-4173-4f3e-b7a4-b3c9c147f718`, separate
  200-character conversational body; the synthetic Threads account is not a
  verified external account.
- PNG: `1713458d-e87b-47a2-a21f-276b6675cb77`, image/png, 87493 bytes,
  SHA256 `7f96666ec05771439961a052ea061b759dd9de1bb1113ef6f0b23fc4bac02382`.
- MP4: `5c954358-fdba-477c-9aba-5f3e441b6d36`, video/mp4, 239343 bytes,
  SHA256 `5c0fb768f3e6e7f6ae8a8d483d48cc98fc0916523e330fae16915ec9068c3c7d`.

Authenticated attachment responses were HTTP 200 and byte-identical to the
agent's actual `draft-review` files. Earlier `workflow` files are different
historical outputs and are not the submitted attachments. The initial rejected
octet-stream upload was not used in either final draft.

Aside u1/Profile 1 opened each draft in the operating port-3100 Marketing menu.
Both previews loaded the actual image (natural width 1080) and video (readyState
4, width 1080, duration 3 seconds). The Naver preview's muted video was played,
advanced from zero to 0.716 seconds and paused. The UI title edit persisted across
reload as revision 2; a body edit persisted across reload as revision 3. Both
test markers were removed through the UI, restoring the agent-authored title and
body at revision 4; authenticated overview confirmed no markers remain and both
media attachments are preserved. SNS remains at revision 1. No approval, queue,
profile traversal or external posting occurred; overview still reports
`publicationEnabled:false` and zero jobs.

The canonical skill's company-ID and explicit multipart MIME clarification was
applied through the native company skill file/version APIs. Current version
`2c065c56-af3b-48f3-a5d2-db1426364fec` (revision 3) has markdown and snapshot
content identical to `skills/marketing-drafts/SKILL.md`. All company agents can
be assigned this skill; runtime tool authorization uses company membership and
native issue assignment, not the test actor's name or fixed UUID.

Completion recheck: production-compatible Marketing service/API, publication
boundary and UI suite passed 61 tests again; ACP policy regression suite passed
7 tests again; canonical diff whitespace check passed. Earlier DB/shared builds,
server/UI type checks, UI build and the 38 Knowledge/Artifacts regression tests
remain the recorded build/deployment evidence, not a claim of a fresh full
repository suite. Source review confirms company/issue/agent matching and active
task states in `assignedIssue`, atomic idempotence/conflict handling, native media
scoping and default transport absence. All 20 deployed feature-file hashes match
the tested candidate; canonical route/service/screen/editor source hashes match
the production-compatible test source. The existing scoped Graphify results and
absent project Hindsight bank were reused, not silently re-indexed or created.

Remaining operational limitation outside this goal: reinstalling the native
Paperclip distribution may overwrite the owned ACP compatibility port. Preserve
the restricted before-file and patch record for rollback or reapplication. This
is not an upstream release. Actual external publication remains intentionally
excluded. Older progress entries below describe historical milestones, not
current blockers or authorization to publish.

Extend existing layers: `packages/shared/src/validators/marketing.ts` owns strict
input and snapshot contracts; `packages/db/src/schema/marketing.ts` owns company
scoped profile/channel/draft/job records; existing Drizzle generation owns additive
migrations. `server/src/services/marketing.ts` owns scoped mutations/transactions,
`marketing-publication.ts` owns content digests/state invariants, and an Aside
boundary owns external execution only. Existing route authentication/activity
logging is reused; only board users authorize/retry/cancel posting. Draft generation
uses native agent execution or explicitly configured generation transport, not a
second task system or uncontrolled external model call.

Generation uses one native assigned Task for selected channels in one project.
The board requests validated task instructions, then creates the Task through the
existing issues API so assignment, budget and wakeup policies stay canonical.
The agent stores a `marketing-drafts` issue document containing strict JSON:
`{topic, drafts:[{channelId, content:{title, body, media}}]}`. A board import reads
that native document, checks company/project ownership and every content/media
item, and atomically creates channel drafts. Re-import returns existing drafts
without overwriting operator edits. No generated document can enqueue publishing.
The instructions/import API and task creation/import controls are implemented.
Actual agent execution and automatic result discovery remain required before M2
completion. The current import control accepts a native task UUID; newly created
tasks retain that UUID in the page URL. Company bootstrap must preserve this URL
reference, while switching an already loaded company clears local drafting state.

Profile stores explicit Aside account ID plus visible Chrome profile name. Current
`aside account list` exposes u0/Profile 0 and u1/Profile 1. Do not change global
defaults, copy Chrome credentials, invent a CLI profile selector, or claim arbitrary
unregistered Chrome profiles can be traversed. Registration/check UI must explain
available bindings and reject unverified execution contexts. No password storage.

Queue approval compares expected revision under row lock; includes channel/profile
identity and configuration digest. Queue dedup is company/draft/revision. Changing
draft or access/identity invalidates unstarted jobs; executing jobs remain pinned.
Workers claim exclusively; restart leaves interrupted external work uncertain.

The native Aside boundary prepares a dedicated non-publishing agent session first:
its only permitted tool action emits `aside.sessions.current().id`. Read the native
session by that ID, persist it on the already claimed job, and only then allow a
resume prompt with publication authority. The installed CLI supports
`aside --account <id> exec --session <id> -- <prompt>`; do not assume it prints
session IDs automatically. CLI exit/timeout is not terminal-state evidence. Query
`aside.sessions.get` plus child-session metadata through native REPL. A missing or
unknown session state, active child, timeout, output limit or lost stream stays
uncertain; no blind new-session publication. Session preparation alone never
authorizes a post. Real owner/content/permalink verification remains separate.
For Naver, read only the validated owner permalink, inspect that post's native
article container (not the whole page), and compare its full title/body. Missing,
ambiguous or changed page structure is unknown evidence. Text-only comparison
requires no image/video/embed components; media publication needs additional
upload/identity evidence. Content equality alone does not prove a newly created
post; the publication adapter must also establish freshness and session outcome.
Global browser dispatch is sequential across profiles. Login failures mark only
that binding blocked; unknown results require reconciliation before any requeue.
Native attachment provenance and current access are checked before approval and
execution; use immutable bytes/checksums, not arbitrary local paths or remote URLs.

Worker boundary: reuse a dedicated native DB connection for one global advisory
dispatch lock, plus company-scoped mutation locks for claims. Persist `publishing`
before browser work. A live/uncertain external session blocks new dispatch until
reconciled, including after restart or a lost CLI stream. Only a terminal verified
receipt may release this guard. Terminal authentication failures block the same
Aside binding, not other eligible profiles; definitely-not-posted failures alone
can retry. The publication transport is injectable for deterministic DB tests,
but mocked receipts are explicitly not Aside/SNS verification evidence.

UI extends existing route/nav and primitives. Project/profile/channel selection,
draft editor/media preview and queue tabs replace a marketing landing page. Stable
loading/error/empty states; token-only styling and mobile layout checks. User
approval buttons are the only path from draft to publishing intent.
Naver channels expose an explicit read-only account check with matched/mismatched
feedback; this check never publishes or authorizes a draft. Refresh refuses to
discard unsaved edits without confirmation. Approval includes the exact body,
target account and media descriptions, not only the draft title.

## Execution checklist

Author attribution follow-up: display an author tag in the existing draft list
and editor header. The overview reads the earliest company-scoped native
`marketing.agent_draft_submitted` / `marketing.draft_created` activity for each
visible draft and resolves the submitted agent ID to a same-company name.
Do not infer authorship from the current task assignee, subsequent edits or the
operator importing an agent document. Operator-created drafts show `운영자`;
missing provenance shows `작성자 미확인`. This is additive overview metadata,
requires no schema migration, and must not change draft content or permissions.
Validate API provenance against reassignment and later submissions, company
isolation and missing history; verify both list/editor tags in the operating UI.
Reuse the existing user-review checklist rather than creating new goal items.

Author attribution implemented and operating-verified on 2026-10-06. Shared
`MarketingDraft.author` is optional/null for compatible mutation/legacy responses;
overview selects the earliest native creation/submission event per visible draft,
joins agents with an explicit company constraint, and never uses task assignment
as an author fallback. Native human audit actors are `user` (not `board`), rendered
as `운영자`. Imported documents without a per-draft creation audit remain unknown.
Existing list and editor display the same author tag with wrapping token styles.

Focused production-compatible suite now passes 64 tests across the existing
Marketing service/publication/UI files. New API coverage verifies original
authorship survives task reassignment, repeated submission and draft edits;
manual creation, missing provenance and foreign-company activity cannot claim
another author. New UI coverage checks both tags and the unknown-author state.
Shared build, server TypeScript emit, UI type check/build and token gates passed;
existing Vite/CSS/chunk warnings are unchanged. No full repository suite claimed.
The same 18-file AST graph was refreshed: 187 nodes / 261 edges; unresolved
external endpoints remain a structural limitation, not runtime evidence.

After verifying idle native runs, the existing service module and UI assets were
backed up to `tmp/marketing-dev/production-backup/author-tags/runtime-before.tgz`
before the scoped overlay/restart. No migration, database record, permissions,
agent model or authentication configuration changed. Config/service hashes are
unchanged and the derived candidate manifest matches the updated service.
Authenticated operating overview resolves both existing real drafts to
`marketer staff_1` (`ec3f77dd-aec9-4359-9fc5-04b0f5f6c2e4`), preserves revisions
4/1 and attachments, reports zero jobs and publication disabled. Aside rendered
`작성: marketer staff_1` in the SNS draft list and editor; the captured operating
view is `2026-10-06_N00hPcM6PRxj5CUt/artifacts/marketing-author-tags.png` under
the selected u1 Aside session. This proves real UI attribution, not just tests.
Rollback restores only the author-tags archive into the installed @paperclipai
directory and restarts the native service; no database rollback is needed.

Color follow-up: the same list/editor author tags use shared token-layer styles
in `ui/src/index.css`: blue for agent authors, green for operator authors and the
existing neutral styling for unknown authors, with lighter text tokens in dark
mode. Text labels remain explicit; color is not the only identity signal.
UI regression suite passes 27 tests, UI type check/build, token gates and
whitespace check pass. Only static UI assets were applied, with a restricted
`author-tag-colors/ui-before.tgz` backup; no service restart or data change.
Aside confirmed both actual agent tags render blue foreground, tinted background
and border; screenshot is in u1 session
`2026-10-06_AxqGMvlBI7GPQyeW/artifacts/marketing-colored-author.png`.
Operator/unknown categories are tested locally; no operating draft was fabricated
to demonstrate them. Dark styles were implemented, not separately browser-tested.

- [x] 프로젝트·채널 설정
  - [x] 프로젝트·프로필·채널 관리 화면 로컬 구현
  - [x] 채널별 컨셉·말투·독자층·작성 규칙 설정 로컬 구현
  - [x] 운영 마케팅 메뉴 반영·확인
- [x] 초안 작성 스킬
  - [x] 블로그·SNS 초안 작성 스킬 생성
  - [x] 회사 스킬 라이브러리에 등록
  - [x] 테스트 마케터에 연결하고 GPT-6 Luna 설정 확인
  - [x] 실제 실행에서 스킬 로드 확인
- [x] 공용 에이전트 도구
  - [x] 특정 에이전트 ID에 종속되지 않는 API 구현
  - [x] 배정된 작업의 채널 규칙·첨부자료 조회
  - [x] 제목·본문·이미지/영상 첨부 ID로 초안 제출
  - [x] 권한·중복 제출·덮어쓰기 방지 테스트 통과
  - [x] 실제 에이전트의 이미지·영상 업로드 및 제출 검증
- [x] 채널별 초안 제작
  - [x] 채널별 독립 작성 지침과 결과 형식 정의
  - [x] 출처·미디어 권리·대체 설명 지침 추가
  - [x] 테스트 마케터가 실제 채널별 초안 작성
- [x] 사용자 검토 화면
  - [x] 초안 목록·본문 수정·이미지/영상 미리보기 로컬 구현
  - [x] 제작 상태·오류 표시 및 완료 결과 가져오기 구현
  - [x] 실제 에이전트가 제출한 결과를 운영 메뉴에서 확인
- [x] 권한·안전
  - [x] 다른 회사·미배정 작업 접근 차단 테스트
  - [x] 중복 제출 방지 및 기존 수정 내용 보호 테스트
  - [x] 초안 제출만으로 승인·발행되지 않도록 분리
- [x] 검증·운영 반영
  - [x] 관련 API·화면 테스트와 타입 검사 통과
  - [x] 화면 빌드 통과
  - [x] 기존 운영 기능을 보존하면서 반영
  - [x] 테스트 마케터의 작성·첨부·제출 전체 흐름 검증
  - [x] 운영 메뉴에서 미리보기·수정까지 검증

Operating preparation uses the existing `tmp/knowledge-dev/production-compatible`
baseline as a derived build, not a second canonical repository. Copy only the
canonical Marketing files and add their import/export/nav bindings. Generate a
baseline-compatible additive migration after the installed journal prefix, build
and test in isolation before applying any live changes. Do not replace the entire
installed core, change credentials, or start publication. Record backup, preserved
identity/settings and rollback evidence before operating application.

Deferred: automatic profile traversal/publication, live SNS publish receipts and
posting failure recovery. Existing implementation is retained but these items are
not required to deliver the revised draft-tool goal and carry no posting authority.

## Validation boundary

The UI preview uses an isolated native development instance on loopback port 3103,
with runtime data under the existing `tmp/marketing-dev` tree. It must not load the
working-directory environment, reuse operating storage, run heartbeat agents or
send announcements. It is a preview, not an operating rollout.

The first verification channel selected by the user is Naver Blog. Read-only Aside
inspection of u1 / Profile 1 confirmed `https://blog.naver.com/ydy1412`; no post was
created. Channel selection is not approval of concrete test text.
Development authorization is not authorization to publish synthetic test material
on a personal SNS account. Fake transport tests prove queue
logic only, not live Aside/SNS publication. Do not mark goal complete until all
requirements and the actual external boundary are evidenced.

## Verified progress (2026-10-06)

- [x] Local schema, company/board-scoped CRUD, hierarchy navigation and UI.
- [x] Native attachment selection, editable text, image/video previews.
- [x] Revision-pinned single/batch approval, cancellation and approval invalidation.
- [x] Native PostgreSQL sequential dispatch invariants with injected test transport.
- [x] Native Aside inventory and read-only Naver account detection.
- [x] Aside 1440x900 UI inspection: sidebar, project/profile/channel tree, draft
  preview, account-check button returning `계정 일치: ydy1412`, no horizontal overflow.
- [x] Native assigned-task instructions and UI creation through existing issues API;
  completed native document import with strict content/media checks and no overwrite.
- [ ] Actual per-channel agent generation execution and automatic result discovery.
- [ ] Actual Aside posting transport, worker/API/operator controls and post evidence.
- [ ] Mobile UI validation, operating-core compatible rollout and real approved post.

Focused test command:
`pnpm exec vitest run server/src/__tests__/marketing-dispatch.test.ts server/src/__tests__/marketing-service.test.ts server/src/__tests__/marketing-publication.test.ts server/src/__tests__/marketing-aside-profiles.test.ts server/src/__tests__/marketing-naver-account.test.ts ui/src/pages/Marketing.test.tsx`
Result before generation additions: 6 files, 49 tests passed. Dispatch tests use fake external receipts and an
owned fresh PostgreSQL database; they do not prove successful SNS publication.
UI and server `tsc --noEmit`, `pnpm check:token-gates`, UI production build and
`git diff --check` passed. Existing Vite configuration, CSS highlight and large
chunk warnings remain. Full repository suite has not been run.

The native dev runner rejected this linked checkout because its worktree env was
absent. Compared native worktree initialization, direct native server boot with an
explicit isolated home, and the existing operating-core overlay approach. Chose
direct native boot for preview only: new PostgreSQL directory, port 54331, server
3103, no working-directory env or heartbeat execution. Operating server 3100 was
not changed. Preview fixtures are synthetic and never queued. Screenshot:
`tmp/marketing-dev/marketing-preview.png`; runtime log:
`tmp/marketing-dev/preview-runtime.log`.

Remaining correctness work: selected older attachment lookup/pagination; actual
agent execution; actual attachment byte verification; fresh
publication/media validation; operating rollout and live approved publication.
Channel configuration snapshots and guarded operator retry/resume are implemented
in the preview with local regression tests. Until the remaining work and live
boundary are complete, the original
M1-M5 execution checklist above stays open.

Generation increment evidence: `marketing-service.test.ts` covers completed native
document import, edit-preserving re-import, no publication jobs, incomplete/invalid
documents, atomic foreign-channel rejection, board-only access and channel-specific
task instructions. `Marketing.test.tsx` covers native issues API task creation,
explicit import and delayed company-context bootstrap. The latter regression was
discovered in Aside, fixed, then verified in the browser again.
Owned preview task `009fffae-f00a-4531-a9ac-f5f6ec483e27` contains an explicitly
synthetic `marketing-drafts` native document. Aside imported it into the editor and
confirmed exact title/body and no horizontal overflow at the existing desktop
viewport. This is native document/UI integration evidence, not actual AI execution.
No fixture was approved or published. Preview runtime was restarted at the same
isolated home; current supervisor PID is 63079. Operating port 3100 remains intact.
Final focused generation increment run: 6 test files, 55 tests passed; UI/server
type checks, UI build, token gates and diff whitespace check passed. The full
repository suite, live agent generation and actual SNS publication remain unverified.

## Aside boundary increment (2026-10-06)

User scope correction: provide agent-facing draft tools, not an autonomous
creator/publisher operated by Codex. Reuse native issue attachment uploads for
image/video files. Add assigned-issue-scoped GET/POST draft-tools: read channel
editorial constraints and submit literal title/body/native media IDs. Agents cannot
approve, enqueue, dispatch, change browser profiles or invoke account checks.
Submission is idempotent per issue/channel; a changed resubmission cannot overwrite
an existing human-edited draft. Published media proof and unattended dispatch are
not prerequisites for delivering these drafting tools. Existing posting code is
left inactive; no external publication is authorized by this scope correction.

Attachment-byte increment: queue approval reads each authorized native storage
object and computes exact streamed SHA-256/byte count against the resolved asset
metadata. Reject missing, changed, truncated, oversized or unreadable files before
creating any queue row. Bound reads to the approved size and 30 seconds and destroy
streams on all exits. Reuse configured storage and its company-key guard; no
arbitrary URLs or client paths. This does not prove upload or posted media matching,
which remain separate unfinished publication requirements.

Generation tracking increment: reuse native issue GET/document-list APIs for the
URL-persisted generation task. Scope-check company/project before showing status
or fetching documents; poll every 5 seconds while active and stop on terminal
states. Show explicit loading/error/missing-result states. Only a done task with
the marketing-drafts document offers one-click import. Import remains an explicit
board action and never approves/enqueues/publishes. Retain the manual UUID import
path for older tasks; existing server import validation remains authoritative.
Implemented in `Marketing.tsx` with native issue/document-list queries keyed by
company, project and task. `Marketing.test.tsx` covers active state without result
access, completed explicit import without approval/publication, company mismatch
without private-title/document exposure, and missing result documents. Focused
UI suite: 23 tests passed; UI type check, production build and whitespace check
passed (existing build warnings unchanged). These are
controlled UI/API tests, not proof of a real agent run, live polling or browser
rendering. Full agent execution and operating deployment remain unfinished.

Manual draft creation increment: opening New draft must not persist placeholder
text. Reuse the canonical draft editor with blank topic/title/body and native
project attachment choices. Save creates the first revision only after validation;
cancel leaves no database draft or queue entry. Unsaved dialog dismissal requires
confirmation, pending dismissal is blocked, and save failures preserve inputs.
Implemented in `Marketing.tsx` using the existing `MarketingDraftEditor` (its
input contract now requires only topic/content/revision, not fabricated database
identity). `Marketing.test.tsx` validates no persistence on open or invalid save,
exact authored content on save, failed-save input preservation, and declined or
confirmed discard without persistence/approval. Result: 19 UI tests passed; UI
type check, production build and diff whitespace check passed. Existing Vite
configuration, CSS highlight and large-chunk warnings remain. This is local UI
validation; the operating port 3100 was not changed, and no live browser workflow
or external publication was performed for this increment.

Approval configuration increment: include the channel's name, concept, tone,
audience and writing rules as literal snapshot fields with a configuration hash.
At claim time compare the stored configuration to the current channel. Missing
legacy configuration or a changed configuration cancels the unstarted job and
requires a newly saved draft revision and explicit approval; never retrofit an
old approved snapshot. No database migration is required for JSON snapshot fields.

Preview transport wiring: a claimed native job supplies the authoritative start time
and immutable hash. Verify the selected Naver account, prepare/persist a native
session, then resume with exactly one publication instruction. The terminal native
session's assistant result must include that job ID, snapshot hash and permalink.
Read the actual article independently, require exact full text and Naver's visible
publication time within the job window, and only then return a published receipt.
Lost output reconciliation reads the same stored session transcript; it never
resumes posting. Initially text-only Naver jobs can execute; media and other
platforms fail before posting until their required verification is wired. This is
an incomplete milestone, not a change to the full M1-M5 goal.
Board-only operator endpoints are `/dispatch` (explicit project ID),
`/jobs/:id/reconcile`, `/jobs/:id/retry`, and `/profiles/:id/resume` (verified linked
Naver channel). Dispatch filters exactly that project; the native global lock
still prevents overlapping browser work across projects. Profile resume rechecks
live account ownership and saved bindings before clearing the login block. It
does not alter approval snapshots or cancel other waiting jobs.
Queue execution requires an explicit operator action/confirmation; there is no
background timer automatically publishing preview fixtures. Reconciliation only
reads the recorded session and article. Retry is available only with terminal,
definitely-not-posted evidence and no blocked profile.

- [x] `marketing-aside-session.ts`: native non-publishing preparation, handle
  persistence callback, same-session resume and native terminal-state inspection.
- [x] Dispatch refuses to replace a captured external handle or continue after a
  handle write fails. The first handle remains available for reconciliation.
- [x] `marketing-naver-post.ts`: validated owner permalink and full scoped article
  extraction; strict text comparison rejects partial text or unverified media.
- [x] Preview publication transport composition and explicit board-only dispatch,
  read-only reconciliation, safe retry and verified profile resume endpoints.
- [ ] Full fresh-post/media proof, operating rollout and live approved publication.

Live native probe prepared session `yNrUOFObYpr76j7u`, captured its ID before
resuming, resumed that exact ID with a non-publishing prompt, and read native idle
state with no children. The execution was not interrupted. Initial execFile probes
timed out without handles because piped stdin remained open; closing stdin fixed
the live adapter. Preparation collects both stdout and stderr tool evidence.
Compared direct CLI execution, combined-stream parsing, and noninteractive stdin
closure; no permission, profile or global setting was changed. A prior same-session
probe also exposed persistent REPL variable collisions; preparation uses block scope.

Read-only existing Naver post `ydy1412/223215916696` provided one native title and
body container, 432 body characters and two image elements. This verifies article
extraction only, not a new publication or approved snapshot equivalence. No post
was created, edited or submitted. Live probes never carried publication authority.

Focused command now includes `server/src/__tests__/marketing-aside-session.test.ts`
and `server/src/__tests__/marketing-naver-post.test.ts` alongside the six files above.
Boundary milestone result: 8 files, 72 tests passed. Server type check and diff whitespace check passed.
Session unit tests use controlled CLI responses; native session execution and native
article extraction were verified separately as stated above. These boundaries are
now composed by the real transport and board routes in isolated preview port 3103;
they are not deployed to operating port 3100. The subsequent transport/UI milestone
passed 9 focused files / 84 tests, UI/server type checks, UI production build and
token gates. Preview queue was empty with execution disabled in a read-only Aside
check. No external article was published; M4/M5 remain incomplete.

Configuration increment validation: native PostgreSQL tests verify immutable
editorial fields and configuration hash, detection of direct channel-setting
changes before transport execution, and rejection of legacy approval without
silently upgrading its snapshot. These are local integration checks, not live
browser publication proof. `marketing-dispatch.test.ts`, `marketing-service.test.ts`
and `marketing-aside-transport.test.ts` are the focused regression files. Result:
3 files / 32 tests passed; server type check and diff whitespace check passed.
