# Dovix Git reorganization — 2026-10-10

## Goal and current evidence

Preserve existing work, correct local branch ownership, introduce a Dovix Git
Flow, and replace the mixed uncommitted state with reviewable checkpoints.
This task does not deploy application code or delete another agent's worktree.

- Canonical checkout: `/Users/ydy1412/projects/Dovix`.
- Original branch/HEAD: `codex/agent-continuity` / `286fad295`.
- Dovix remote `origin/master`: `995372fda`; actual remote confirmed unchanged.
- Local `master`: `6a72faf83`, incorrectly tracking `upstream/master`.
- Original changed paths: 245; 19 were local Graphify outputs.
- Two task worktrees are clean. The detached compatibility worktree has 72
  status entries and is preserved in place; it is not the canonical dev branch.
- Main checkout and installed runtime are distinct. No current runtime commit
  can be inferred from the release version or a Git branch name alone.

## Recovery already recorded

- Git recovery ref: `archive/workspace-20261010-092155`.
- Recovery commit: `e9d7f7fd18bb10e3a2b41622a653dd4dbe6ab5de`.
- Ignored recovery directory: `tmp/git-reorganization/20261010-092155/`.
- The directory contains original refs/config, a binary tracked patch, a
  working-file archive and per-file SHA-256 checks. Every archived working file
  matched its source. The recovery commit also includes generated graph files;
  it is an unvalidated local recovery snapshot, not a production release.

## Execution plan

1. Preserve the former upstream-tracking master under `archive/*`, then create
   a local `master` that tracks the actual `origin/master` without force-push.
2. Start `develop` from the Dovix master. Preserve all existing feature refs
   and occupied task worktrees. Create `feature/dovix-baseline` from the original
   continuity branch, incorporating the existing Dovix master ancestry without
   changing application file contents.
3. Record existing work in checkpoints for Git/docs, runtime authentication and
   continuity, knowledge, plugin contracts, marketing, sourcing, agent profiles,
   database migration metadata, dependencies and common integration wiring.
   Because shared files couple these features, inspect the final combined tree;
   do not claim each intermediate checkpoint is independently buildable.
4. Keep Graphify outputs local. Update the structural graph without semantic
   extraction and use current source to confirm important relationships.
5. Run appropriate verification. Promote to `develop` only when the combined
   baseline meets the documented integration gates. A failing preexisting code
   check blocks promotion, not preservation or completion of Git cleanup.
6. Verify original source hashes, migration inventory, branch ancestry, remote
   tracking, clean working status and original task-worktree preservation.
   Document any unpublished refs and outstanding verification explicitly.

## Decisions

- `master` / `develop` / `feature/*` / `release/*` / `hotfix/*` is the local
  Dovix workflow. `upstream` remains a read-only source, not the release remote.
- Lockfile changes are committed with the Dovix dependency manifests. The
  upstream-only trusted-runner policy is not assumed to regenerate this fork's
  dependencies before a reproducible local checkout is available.
- Compatibility and task worktrees are not cleaned or rebased during this task.
- No remote branch deletion, history rewrite, automatic hook installation or
  production deployment is included.

## Verification and handoff

### Preserved baseline

The existing source was recorded in these ten checkpoints. They preserve one
coupled baseline; shared wiring and migration inventory land later in the
sequence, so intermediate commits are not asserted to build independently.

| Commit | Purpose |
| --- | --- |
| `6b3b470150e6` | Git workflow, repository instructions and local-output exclusions |
| `8eea8e494766` | Existing dependency manifests and matching lockfile |
| `7f4573469fd2` | Existing authentication and continuity safeguards |
| `6147a5c1ed64` | Knowledge library and artifact folders |
| `2c614a94b4b4` | Plugin contracts and host services |
| `f45485c73b1a` | Marketing drafts and connection workflows |
| `9b40ddc30a78` | Sourcing catalog, orders and forwarding settings |
| `9cdc59e0ad33` | Agent profile management |
| `6459ea158886` | Coupled database migration inventory |
| `78756a2b7412` | Shared exports, application routes and navigation |

An ancestry merge at `2621128f9f1f` preserves the original continuity tree while
including the existing Dovix master history. All 226 original application,
asset and document paths were compared to the recovery manifest using SHA-256
of committed blobs; every byte matched. Only Git workflow documentation and
the local Graphify ignore rule were added during this reorganization.

### Branch and remote state

- Current checkout: `feature/dovix-baseline`.
- `master` now tracks `origin/master` at `995372fda`.
- `develop` was created at the same release commit. The feature baseline is
  not merged into it because an integration gate failed.
- The former local master is preserved as
  `archive/upstream-master-20261010-092155` at `6a72faf83`.
- All original refs other than the corrected master role were preserved. The
  old `codex/agent-continuity` remains at `286fad295`.
- Both task worktrees retain their original commits and remain clean. The
  detached compatibility worktree retains its original commit and 72 status
  entries. This task did not modify their files.
- Local pushes default to `origin`; `upstream` keeps its fetch URL and its
  local push URL is disabled. Fast-forward-only pulls are configured locally.
  No global Git configuration or hooks were installed.
- The user explicitly approved publication to the public Dovix GitHub fork.
  An atomic push created `origin/develop` and
  `origin/feature/dovix-baseline`, with matching tracking configuration.
  Recovery refs remain local. A subsequent `git ls-remote` confirmed
  `origin/master` and `origin/develop` at
  `995372fdaf99c21d264fdb3cfaf56f9bb6c6d966`, and the application baseline
  checkpoint on the feature branch at
  `78756a2b741259acd9c9fcded16f2f97e7503453`. This handoff update is a later
  documentation-only commit; the application checkpoint remains unchanged.

### Verification

- Recovery archive: all 245 captured paths matched their source hashes.
- Git object consistency: `git fsck --no-dangling` passed.
- Whitespace: `git diff --check origin/master...HEAD` passed.
- UI token gates: `pnpm check:token-gates` passed.
- Plugin SDK build dependencies: `pnpm --filter @paperclipai/plugin-sdk
  ensure-build-deps` passed.
- Full `pnpm typecheck` failed in the preserved auto-sourcing plugin:
  `packages/plugins/plugin-auto-sourcing/src/worker.ts:11:107`, TS18046,
  `params` has type `unknown`. The database migration numbering and safety
  checks passed during this run. The recursive run stopped at the first
  failing package, so it does not prove every remaining package passed.
- Focused run: `pnpm exec vitest run` with the 52 changed `.test.ts` and
  `.test.tsx` paths selected explicitly. It finished with exit code 1:
  49 files passed, 3 failed; 1,005 tests passed, 3 failed (1,008 total).
  This selection does not include separate plugin `.spec.ts` or Python tests.
  The recorded failures are:
  - `cli/src/__tests__/doctor.test.ts:116`: repaired diagnostic expected zero
    failures but received two.
  - `ui/src/pages/Sourcing.test.tsx:79`: an upload-view expectation still
    requires the disconnected processing-service message.
  - `ui/src/components/Sidebar.test.tsx:566`: expected Org labels omit the
    current agent-profile menu.
  These failures block integration; preservation of their source is not a
  claim that their behavior or assertions are correct.
- Full test-suite and production build gates were not run after the failed
  type check. No CI success, live service validation or deployment is claimed.
- Graphify was updated once with `graphify update . --no-cluster`: 78,232
  nodes and 222,753 edges. Its 233 zero-node file warnings are a coverage
  limitation. Profile and forwarding relationships were queried and checked
  against current source. Generated outputs remain ignored and local; no
  semantic document extraction, hooks or watchers were installed.

### Recovery and next integration

The recovery manifest, original refs/config, patch, archive, checkpoint
inventory and local test log are under the ignored recovery directory above.
To inspect the original mixed workspace without replacing the current checkout,
create an isolated worktree from the preserved recovery ref:

```sh
git worktree add --detach tmp/git-reorganization/recovered-workspace \
  archive/workspace-20261010-092155
```

Future work starts on a purpose-specific feature branch. Resolve the recorded
baseline blockers and rerun the failed checks, then complete the full test and
build gates before merging this baseline into `develop`. A release remains a
separate verified promotion to `master` and a commit/tag-linked deployment.
