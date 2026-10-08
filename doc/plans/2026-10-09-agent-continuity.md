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
