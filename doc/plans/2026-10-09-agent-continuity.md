# Agent continuity POC

Canonical implementation plan. Requested feature reference: `docs/continuity-layer.md`.

## Source investigation

- Agent UUID is canonical; names produce URL keys, not provider identity (`schema/agents.ts`, `services/agents.ts`).
- Task sessions are unique by company/agent/adapter/task key. Provider processes can finish while their continuation identifiers remain (`agent_task_sessions.ts`, Codex/Claude execute and session codecs).
- Heartbeat owns dispatch, cancellation, provider execution and durable results. Native runtime has checkpoint/resume proof, process identity, leases and restart reconciliation. These mechanisms remain authoritative.
- Tasks own assignment/state; comments/mentions and persistent conversations are task-backed and may authorize wakes. They cannot supply task-free communication without changing their semantics.
- Execution workspaces reference company/project/source task and retain cwd/branch/provider metadata. Session existence is independent of workspace existence.
- Existing native-session-handoff creates bounded, redacted task history for fresh providers. Extend its loader; preserve authorization and low-trust boundaries.
- Migrations are additive Drizzle-generated SQL plus journal/snapshot. Pending local migrations 0295–0299 and other user changes must be preserved and excluded from continuity commits.

## Requirements and actual plan

1. Optional lowercase company-unique seat alias. Existing UUID remains every FK. Alias lookup precedes name-derived URL key lookup.
2. One durable mailbox delivery row per recipient; broadcasts share thread ID. Recipients mark only their delivery read. Agents access their own mailbox/thread participation; board reads company-scoped records. Send/read create audit records and never create, assign or wake tasks.
3. Immutable validated JSON checkpoint with Markdown representation. Explicit `checkpoint_only` saves history, `resume` preserves session, `fresh_with_handoff` marks the existing task-session row for fresh dispatch. Previous provider parameters remain until the next dispatch succeeds. Rotation is forbidden with queued/running/retry work. A dispatch validates its linked handoff before ignoring session IDs and uses the existing handoff loader.
4. Restore is a read-only assessment, not a recovery controller. Verify task ownership, workspace/path/branch and adapter binding. Persisted ID alone yields `awaiting_decision`; provider failure yields `failed`; invalid association/workspace yields `attention_required`; pending validated handoff yields `fresh_with_handoff`. Historical successful runs are evidence of past execution, never proof of a live resumed provider after restart. Existing native reconciliation remains responsible for actual resume.

No new orchestration queue, runtime, memory store, ownership or lifecycle. No live service restart or production DB migration is part of this POC.

## Acceptance and test plan

- [x] Alias nullable migration, company uniqueness, alias rename leaves sessions/tasks/history intact.
- [x] A→B/broadcast, thread, unread/read, related task, cross-company and spoofing rejection; no task ownership mutation.
- [x] Complete handoff round-trip, incomplete/oversized/stale handoff rejected, active-run rotation rejected, transaction rollback leaves session intact.
- [x] Fresh dispatch ignores old provider ID and receives all checkpoint fields; successful dispatch restores normal resume policy; failed dispatch retains checkpoint.
- [x] Two separate Node process boots on the same durable DB report saved-ID uncertainty, handoff readiness and missing workspace honestly; native proof from an old controller boot is rejected.
- [x] API authorization, real embedded PostgreSQL migrations/integration, existing handoff/session/heartbeat regression tests.
- [x] Minimal UI alias/mailbox/checkpoint/policy/status, Aside fixture interaction, UI and type/build checks.
- [x] Existing full suite attempted; failures inspected and isolated without changing production authentication settings.
- [ ] Fully passing existing suite: initial server lane failed and the wrapper stopped before subsequent non-server/serialized lanes. Live provider/deployed restart coverage remains unverified.
- [x] Final diff and documentation reconciliation; scoped graph refresh; meaningful task-only commits.

## Validation log

Checked on 2026-10-09. Logs are local ignored artifacts under `tmp/continuity-dev/`; the commands and results below are the durable record. Counts overlap between runs and must not be added together.

| Command / evidence | Result |
| --- | --- |
| `pnpm exec vitest run packages/db/src/agent-continuity-migration.test.ts server/src/__tests__/agent-continuity.test.ts server/src/services/native-runtime/native-session-handoff.test.ts server/src/services/native-runtime/native-session-resume.test.ts server/src/__tests__/native-session-resumption.test.ts server/src/__tests__/adapter-session-codecs.test.ts server/src/__tests__/heartbeat-workspace-session.test.ts ui/src/pages/agent-detail-navigation.test.ts` | Final implementation: **8 files, 254 tests passed**; `targeted-regression-final.log`. |
| `pnpm exec vitest run --exclude '**/dist/**' --project @paperclipai/adapter-codex-local --project @paperclipai/adapter-claude-local` | **50 files passed, 1 skipped; 813 tests passed, 2 skipped**; `adapter-regression-source.log`. An initial invocation without the repository's source-only exclusion also collected compiled tests and failed on four uncopied fixture files; corrected selection passed. |
| `pnpm exec vitest run --project @paperclipai/ui` | **691 files, 7,505 tests passed**; `ui-tests.log`. |
| `pnpm --filter @paperclipai/db check:migrations` | Passed; historical findings covered by existing baseline; `migration-check.log`. |
| `CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 pnpm -r --workspace-concurrency=1 typecheck` | Passed; `all-types-retry.log`. Initial parallel typecheck hit Rust `No space left on device`; only this task's newly rebuilt debug cache was removed before reducing build footprint. No global profile/config change. |
| `CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 pnpm -r --workspace-concurrency=1 build` | Passed; `build-retry.log`. Initial parallel build exited 1; no unsupported cause is claimed from its truncated output. |
| `pnpm --filter @paperclipai/shared typecheck`; `pnpm --filter @paperclipai/server exec tsc --noEmit`; `pnpm --filter @paperclipai/ui typecheck`; `pnpm --filter @paperclipai/ui build`; `pnpm check:token-gates`; `git diff --check` | Final affected-source checks passed; `final-*-types.log`, `final-ui-build.log`, `token-gates.log`. Server types and the 254-test selection were repeated after the final dispatch-time workspace guard. |
| `pnpm test:run` | **Failed:** first general-server lane: 760 files passed, 3 failed, 5 skipped; 15,123 tests passed, 160 failed, 89 skipped. Wrapper exited before later lanes. `full-tests.log`. This run preceded the last safety refinements; final targeted tests above cover those refinements. |
| `pnpm exec vitest run server/src/__tests__/chat-channels.integration.test.ts -t 'retains only the actual Teams activity clock, not SDK display fallback \(hour24\)'` | Representative full-run failure passed alone: 1 passed, 1,062 skipped; `full-failure-diagnostic.log`. |
| `pnpm test:run --mode general --group general-chat` after own fixture cleanup | **1 file, all 1,063 tests passed**; `chat-regression-after-cleanup.log`. Does not replace the root wrapper's remaining lanes. |
| `pnpm exec vitest run --exclude '**/dist/**' server/src/__tests__/ai-connections.test.ts -t 'turns a .* auth failure into one card'` | Reproduced 4 authentication-setting conflicts; 50 skipped; `ai-failure-isolation.log`. |
| Same source-only selection of `ai-connections.test.ts` and `agent-hire-ai-connections.test.ts` from the canonical checkout path | 68 passed, 40 failed; `ai-regression-canonical-path.log`. No production auth check was weakened. |
| `node cli/node_modules/tsx/dist/cli.mjs tmp/continuity-dev/ai-auth-diagnostic.ts` | Existing `assertManagedAiProjectAuth`: checkout default rejected for both providers; isolated disposable cwd passed for both. Diagnostic emits no credential values. `ai-auth-diagnostic.log`. |
| Aside REPL, explicit existing `u1` profile | Actual new UI component + actual continuity routes on isolated PostgreSQL: alias save, complete fresh handoff reservation, self-message unread/read and status verified. `aside-browser-verified.log`. Preview supplied operator identity; full authenticated AgentDetail deployment was not tested. A full-page capture artifact was unreliable and is not treated as layout proof. |

Migration coverage is in `packages/db/src/agent-continuity-migration.test.ts`: reconstruct pre-POC tables in a disposable PostgreSQL database, insert old agent/session data, apply generated 0300 SQL, preserve UUID/provider parameters, and check repeat migration. API/heartbeat/restore coverage is in `server/src/__tests__/agent-continuity.test.ts`; its child process helper is `server/src/__tests__/fixtures/continuity-restart-probe.ts`. Provider execution in the new POC tests uses a fixture adapter, not real credentials.

The final safety review added complete packet/workspace validation, dispatch-time local workspace/branch recheck, source-trust quarantine enforcement, legacy identifier compatibility, readable Markdown and failure-aware UI refresh. All remain within the requested POC.

## Regression blockers and bounded diagnostics

1. **Disk capacity:** chat failure stacks show PostgreSQL `53100` and filesystem `ENOSPC`. Inspected available space, removed only this task's generated Rust debug cache, and cleaned the completed full-suite's own fixture root after stopping its orphan test-runner descendants. Read-only fixture directories required restoring their own write bits for cleanup. User data and operating processes were preserved. The focused whole-chat retry after cleanup passed all 1,063 tests; the entire 40-minute root run is not replayed merely to hide its failure.
2. **Project authentication environment:** both failed AI suites traverse from the checkout through parent provider configuration. Only conflicting key names were inspected, never credential values. `ai-connection-runtime.ts` is unchanged from the starting commit. Full-run failure, isolated reproduction, disposable-cwd diagnostic and canonical-path retry were inspected. The path retry still failed; no further autonomous workarounds or unrelated fixes are applied. Recommended resolution: run the existing suites in a clean isolated workspace/CI environment and then rerun the complete wrapper. Do not disable authentication checks or modify the user's provider configuration.
3. **Scope of proof:** fixture adapter execution, native receipt/lease fixtures and two real process boots verify local behavior. They do not establish real Codex/Claude account continuation, native provider liveness, OAuth, or operating-server restart/migration success.

## Final review and retrieval evidence

- Hindsight: focused recall in existing project bank `codex-Dovix-0ad604734878`; no relevant continuity design decision returned. Local source/documents drove the implementation.
- Optional final memory storage was not performed: dedup recall and bank lookup later failed transport; read-only HTTP health and TCP-listener checks confirmed the local endpoint was unavailable. No restart/configuration change or built-in memory-file write was attempted.
- Graphify: queried the existing scoped graph, verified relevant relations against source, then refreshed 12 affected code files with AST extraction. Final graph: 1,875 nodes / 2,728 edges, 1,448 unselected node IDs preserved, zero model tokens. Unselected files remain historical graph context; no global freshness claim, paid semantic scan, hooks or watcher.
- Preserved 52 untouched pre-existing tracked dirty files byte-for-byte. Four shared files were staged from tracked HEAD with continuity additions only. Pending user migrations and the full local schema snapshot/journal were not included in these commits.
- An abandoned empty Git index lock had no active Git process or open-file owner; it was moved to task diagnostics before task-only commits. No user source/history was deleted.
- No operating service restart, production DB migration, merge, push, second orchestration store or OpenRig source copy was performed.
- Isolated browser preview and identified orphan test-runner processes were stopped; the preview DB/workspace and completed full-suite fixture root were cleaned up. Ignored diagnostic logs and remaining test-wrapper artifacts are retained locally.

## Authentication-only follow-up (2026-10-09)

The user narrowed follow-up regression work to the two managed AI authentication
suites. Their default project cwd currently inherits local checkout/ancestor
provider configuration. Isolate only the test process cwd to the disposable
fixture home; keep production project-auth rejection and explicit conflicting
project fixtures unchanged. Run these two suites, record counts, and verify
production authentication source/configuration was not changed.

- [x] Isolate default authentication fixture cwd.
- [x] Pass both authentication suites including negative project-config cases.

Authentication-only result: `pnpm exec vitest run server/src/__tests__/ai-connections.test.ts server/src/__tests__/agent-hire-ai-connections.test.ts` passed **2 files / 108 tests**, including real explicit project-conflict rejection cases. Evidence: `tmp/continuity-dev/authentication-isolated.log`. Only test fixtures changed; production `ai-connection-runtime.ts` and personal provider settings were not changed. The user did not request rerunning the remaining full-suite lanes in this follow-up. This does not convert the earlier incomplete root-suite result into a passing full suite.

The cause/fix was deduplicated, retained and read back with matching provenance in existing project bank `codex-Dovix-0ad604734878`, document `dovix-auth-fixture-cwd-isolation-2026-10-09`. No secrets or transcripts were saved.


## Agent skill alignment follow-up (2026-10-09)

User asked whether existing skills were adapted to the new collaboration feature
and proposed a sourcing-product processing skill for agent development. Inspection
found source mailbox/checkpoint routes but no extension guidance in the core
Paperclip skill/API reference. Read-only live check found no installed continuity
route file/mount and authenticated mailbox GET returned JSON HTTP 404. The POC
remains undeployed; this is not a skill update or operational deployment proof.

Plan: update only the repo-owned `skills/paperclip/SKILL.md` and its API reference,
with a focused continuity reference. Preserve task checkout, assignment, wake,
budget and approval semantics. Mailbox is information, never execution authority.
Support own mailbox/thread reads and checkpoint_only for agents; session policy
changes remain board-only. Feature-gate the undeployed extension; no service
restart, database migration, mass cache edits, global-skill changes or messages
are part of this follow-up. Add a repo-owned sourcing-processing skill separately
in the established `skills/` root and mark missing plugin actions as proposed.

- [x] Adapt core skill and API docs to exact current mailbox/handoff contracts.
- [x] Validate frontmatter, links and examples against source schemas/routes.
- [x] Reconcile source skills versus installed/assigned/actually used skills.

Result: repo-owned core skill and API-reference entrypoints now link
`skills/paperclip/references/agent-continuity.md`, covering exact mailbox routes,
UUID identity, thread/read/send semantics, non-idempotent uncertain delivery,
all structured checkpoint fields, agent-only checkpoint_only policy and honest
restore assessment. Older runtime availability is explicitly checked first;
permissions/ownership/task lifecycle remain authoritative.

Validation: both skill-creator quick_validate runs passed; exact send/checkpoint
JSON examples pass shared Zod schemas, all three new relative links resolve and
API routes match current source. Receipt: `tmp/continuity-dev/skill-alignment-validated.json`.
Existing real isolated-Postgres continuity tests passed 15/15:
`pnpm exec vitest run server/src/__tests__/agent-continuity.test.ts`, log
`tmp/continuity-dev/skill-alignment-continuity-tests.log`. These tests do not prove
that a live agent loaded the new skill or used the production mailbox.

Read-only installed/live verification: runtime has neither route module nor
mount; authenticated mailbox GET is JSON 404; installed core skill has none of
mailbox/checkpoint_only/fresh_with_handoff guidance. Source edits are complete,
operating deployment/managed skill import and live agent use are not performed.
The existing incomplete full-suite/provider/restart limitations still apply.
No production code, service process, DB, installed skill/cache, role/model or
agent assignment was changed.

Hindsight was queried in the existing Dovix bank; relevant order-read tool
boundaries were verified against the source manifest. Initial structural graph
covered orders/forwarders rather than continuity. Extended it with six known
source files: 18 files total, 105 nodes / 158 edges, source SHA256 freshness
manifest in graphify-out/scope.json, bounded vocabulary-grounded query. Source-only
extraction used no paid semantic scan or hook.

Selective Hindsight record `dovix-skill-continuity-processing-alignment-2026-10-09`
completed extraction and recall returned matching document/source metadata. It
preserves the verified source/runtime/tool boundary, not a claim of live rollout.

## Authorized operating rollout and development assignment (2026-10-09)

The user approved the proposed next increment: deploy continuity, install/assign
the maintained skills and delegate one product's evidence -> editable processing
draft -> validation/review development to an existing Dovix developer. Preserve
the operating orders, carriers, multiple forwarders, Marketing and Knowledge.
Do not hire agents, change provider/model/security defaults or publish products.

Deployment plan: use the installed 2026.1001.0 runtime as the compatibility base,
stage only continuity schema/shared contracts, routes/service, alias handling,
dispatch/handoff hooks and the existing continuity UI. Preserve unrelated newer
source edits. Validate additive migration in an isolated database and selected
runtime API/session behavior before applying. Pin installed file hashes, retain
private file/database backup and verify no active execution before the authorized
restart. Recheck live authenticated APIs, existing data hashes and plugin health.
Do not run the newer checkout's complete migration chain on the operating DB.

Compatibility finding: the installed heartbeat has the existing
`paperclipSessionHandoffMarkdown` context path consumed by both local Codex and
Claude adapters, but lacks the newer native-session-handoff loader. The selected
port will render the validated structured packet through that existing path,
force a fresh provider session, retain saved continuation parameters on failure
and restore normal resume policy only after confirmed provider session success.
No new adapter/runtime or synthetic live recovery proof is introduced. Stage
current continuity routes/service against installed dependencies and test them.

Skill compatibility refinement before agent dispatch: the current checkout's
core skill differs from the installed baseline beyond the requested extension.
Retain the older runtime's existing core skill/API reference and apply only the
new continuity entrypoint/link plus its new reference. Product-processing skill
is imported intact through the existing company library. This avoids replacing
unrelated adapter-era guidance as a side effect of rollout.

Delivery plan: use the existing company-skill import/update and assignment API;
preserve each agent's current desired skill set. Attach the processing skill to
Developer_1 and the existing reviewer where their assigned responsibilities need
it. Define one bounded developer issue with explicit skill paths, canonical
repos/docs, no marketplace writes and evidence/revision/reload acceptance checks.
Verify the actual adapter workspace and skill delivery before dispatch. Coordinate
through the existing Paperclip task lifecycle; a mailbox message alone is not
authorization to execute. Report assignment and actual completion separately.

- [x] Stage a compatible selected runtime and isolated migration/API validation.
- [x] Apply backed-up runtime/schema and verify live restart/data/API preservation.
- [x] Import/assign maintained skills and verify runtime content delivery.
- [x] Create/dispatch the bounded product-processing developer task.
- [x] Review its result before reporting the single-product loop complete.
- [x] Reconcile rollout evidence, limitations and selective durable memory.

### Managed Codex dispatch blocker found during rollout

DOB-27's first real dispatch was stopped before provider execution with
`configuration_incomplete/ai_connection_incompatible`. No skill use or developer
implementation occurred. Exact diagnostic checks found only host-global
`~/.codex/config.toml`'s `model_provider` key, outside either actual repository;
values/credentials were never printed. The existing validator scans to filesystem
root even though managed runtime creates an isolated CODEX_HOME/provider config.

Alternatives inspected: keep the selected existing AI connection (changing it
does not correct the scan and would alter provider choice); per-task cwd bound to
the actual repo (old scan still includes host global); normal home-scoped isolated
workspace (same ancestor conflict, and dirty source would need a separate seed).
Do not move work to a clean unrelated cwd to skip a real project override.

Scoped correction: for local managed OpenAI validation, resolve the actual Git
root from configured cwd and scan all project configs from cwd through that root.
Maintain the same override pattern and command-argument rejection. Non-Git and
remote checks retain conservative ancestor scanning; Anthropic behavior is not
changed. Preserve real repo-level/nested authentication rejection and Git worktree
root support. Bind DOB-27's initial task cwd explicitly to its existing registered
repository before retrying, preserving model, connection and user config.
Source: OpenAI configuration precedence documentation (project-root through cwd,
user config separately); local managedAiHomeEnvironment and direct live rejection.
Official reference: https://developers.openai.com/zh-Hans/docs/config-file/config-basic
Validate with isolated real Git fixtures and the two existing auth suites, port
only this correction onto installed code, back up/hash-check and retry the task.

- [x] Verify outside-Git settings separation, repo/nested overrides, worktree root
  and conservative non-Git behavior without weakening command/remote checks.
- [x] Pass existing managed-auth suites and installed-code diagnostic checks.
- [x] Apply the backed-up correction, preserve private configuration hashes and
  retry DOB-27 with its exact registered repository cwd.

### Rollout evidence

Selected runtime 19-file port and SQL `0300_agent_continuity` mapped to runtime
`0288_agent_continuity` were applied with pinned hashes and private backup.
Receipt: `tmp/continuity-dev/operating-rollout/applied.json`, stage complete.
Authenticated live mailbox/continuity/handoff reads return JSON 200; anonymous
mailbox remains denied. Orders, Marketing publication jobs, registered forwarder
metadata and existing provider-session parameters retain identical hashes/data.
Knowledge, Marketing and Auto Sourcing plugins remain ready after restart.
Existing core guidance is preserved with only conditional continuity additions;
`compatible-core-skill.json` records that compatibility refinement.

Validation: source migration/continuity/navigation selection passed 3 files/19
tests (`source-tests.log`). Installed-base isolated PostgreSQL migration, scoped
mailbox/alias/checkpoint authorization, corrupt/stale handoff rejection, and a
fixture fresh heartbeat delivering all structured fields and restoring resume
policy passed (`compatible-verified.json`, `compatible-tests.log`). This fixture
does not verify real provider resumption after a restart.

Compatible UI Vite build passed. Its full type check has the same 15 pre-existing
diagnostic lines as the measured baseline, with no new diagnostics after the
continuity preview-dictionary update (`compatible-ui-{baseline,final}-types.log`).
These baseline diagnostics are not a fully passing UI typecheck. Token gates and
diff whitespace passed. The source server typecheck passed. Aside u1 inspected
the actual operating Agent Detail Continuity / Mailbox page, existing task-state
explanation, handoff controls and message section; screenshot/tree are
`continuity-live.png` and `continuity-live-tree.txt`. No live message/checkpoint
write or provider-authentication form submission was performed for UI testing.
Owned browser tab was closed; original tabs/profile/defaults were preserved.

The auth correction passed both existing auth suites plus one real Git fixture
covering outer settings separation, actual root/nested overrides, conservative
non-Git checks, blocked command flags, detached Git worktree roots and canonical
macOS symlink paths: 2 files/109 tests (`auth-project-scope-tests.log`). Source
server typecheck passed (`server-types.log`). Only the corresponding installed
function was ported; backups and source hashes are in `auth-scope-applied.json`.
Existing user provider configuration hash is unchanged. Source graph refresh
updated only this indexed auth module, preserving unrelated nodes: 105/158.

Company skill `sourcing-product-processing` was imported from the maintained
repo and added to Developer_1 and code reviewer without replacing their prior
skills (`skills-installed.json`). Both processing files and core continuity
reference exist at each configured runtime source. DOB-27 is assigned to the
existing developer with primary registered .NET workspace and an additional
Dovix connector workspace. At the initial progress snapshot after the bounded
auth correction, actual run `ee04982f-8545-4d2b-b618-7739de5c0036` was running
and the task was in_progress.
Redacted run events confirm skill injection, successful processing-development
reference read, own mailbox GET and own continuity GET. The complete SKILL.md
read is not independently proven by the bounded parsed-event receipt. Evidence:
`developer-progress-evidence.json`; processing implementation and reviewer outcome
were pending at that snapshot. Final source results are recorded below; actual
merchant-product processing remains unverified. Do not label assignment/run start
as completed development.

### Processing skill inventory reconciliation

As DOB-27 delivers source tools, update the existing two-file processing skill
to describe exact source contracts while retaining mandatory live discovery.
The operating plugin still has the prior order-read inventory until a separately
verified compatible rollout. Category metadata and actual pixel derivatives
remain missing; a crop plan is pending. Preserve the same company skill key,
previous agent assignments and one-owner/revision handoff rules. Validate the
skill and import current files through the existing company mechanism after the
implementation review; do not confuse source inventory with runtime availability.

### Completed development handoff and review

DOB-27 source development and DOB-28 independent review are done. The delivered
scope is source evidence -> editable owned draft -> validation/reload, verified
with synthetic input only. The reviewer found no blocking source defect and
independently passed 6 real-file/SQLite/HTTP and 2 actual worker-host-.NET tests.
The immutable uploaded review bundle was downloaded locally; all 44 archive
manifest hashes and all 39 current source/test file hashes matched. Its two Aside
viewport images show Korean original/proposed SKU edits, preserved original
facts and pending category/required-fields/crop review. Existing full-page capture
was excluded by the developer. Exact results and files remain canonical in
`../auto-sourcing/specs/005-product-publishing/processing-result.md` (sibling repo).

The extra DOB-29 review briefly overlapped the developer-created DOB-28; only
DOB-29 and its own run were cancelled after verifying the overlap. DOB-28
completed normally. No source edits were performed by the reviewer. Parent
verification reused the immutable logs/images and verified current source hashes
instead of re-running the already successful feature suites.

The skill's exact source contract inventory is updated and quick_validate passed
with the existing Graphify Python environment; default Python lacked PyYAML, so
no dependency installation/global environment change was made. Company reimport
retained the same skill ID/key, previous core skill and two existing assignments.
Receipt: `skills-refreshed.json`. Initial installation receipt is historical;
actual developer delivery/read evidence and completed independent review are
separate facts. Processing runtime deployment, real merchant product handling,
provider category metadata and actual pixel crops remain unperformed.

Developer scoped Graphify refreshes used AST only: 17 Auto Sourcing files and 21
Dovix files, preserving unrelated nodes. Parent verified every recorded selected
hash current (graphs 2714/5329 and 1087/1748 respectively). The earlier 105/158
auth refresh is an earlier snapshot, not the final graph size. Hindsight project
bank records `dovix-continuity-operating-rollout-2026-10-09` and
`dovix-product-processing-source-loop-2026-10-09` passed focused duplicate checks,
selective retain and subsequent document-ID-matched recall. They update the
previous undeployed/source-missing boundaries without storing credentials,
customer data or a transcript. Built-in Codex memory files were not changed.

Final verification receipt `final-verification.json` confirms DOB-27 and DOB-28
done, cancelled duplicate DOB-29, successful developer closing run, service health
ok and current company skill Markdown/runtime files read back. Test preview,
owned Aside REPL and deployment helper processes are closed. Reconciled the four
existing main graph-scope hash entries affected by the processing increment;
no further extraction ran. Both repositories passed final diff whitespace checks.
