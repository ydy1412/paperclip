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

Pending execution. Record resulting checkpoint commits and branch state here,
with exact verification results and promotion/publication status.
