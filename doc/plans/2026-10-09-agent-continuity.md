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

- [ ] Alias nullable migration, company uniqueness, alias rename leaves sessions/tasks/history intact.
- [ ] A→B/broadcast, thread, unread/read, related task, cross-company and spoofing rejection; no task ownership mutation.
- [ ] Complete handoff round-trip, incomplete/oversized/stale handoff rejected, active-run rotation rejected, transaction rollback leaves session intact.
- [ ] Fresh dispatch ignores old provider ID and receives all checkpoint fields; successful dispatch restores normal resume policy; failed dispatch retains checkpoint.
- [ ] New service instance after restart reports saved-ID uncertainty, handoff readiness, missing workspace and failed execution honestly.
- [ ] API authorization, real embedded PostgreSQL migrations/integration, existing handoff/session/heartbeat regression tests.
- [ ] Minimal UI alias/mailbox/checkpoint/policy/status, UI and type/build checks.
- [ ] Full suite, final diff, docs reconciliation, scoped graph refresh, meaningful task-only commits.

## Validation log

Pending implementation. Live Codex/Claude account execution and deployed restart are not verified by fixture tests.
