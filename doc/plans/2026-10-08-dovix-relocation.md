# Dovix local project relocation

Date: 2026-10-08

## Requirement and scope

The user selected **Dovix** as the name of their personal master program and
requested moving the existing development project into the Projects directory.
The current development checkout is `/private/tmp/paperclip-knowledge-current`,
on `codex/knowledge-hindsight` at
`34874719c9be4a1eab4cd9359b98baae1d9677db`.

The canonical destination is `/Users/ydy1412/projects/Dovix`. Preserve the
current source, uncommitted changes, untracked files, installed dependencies,
development data, Git history and three nested worktrees. Use independent local
Git metadata for Dovix; retain existing remote configuration as historical
upstream metadata. Creating a new remote or changing package names, UI branding,
production installation, authentication, databases or API contracts is outside
this relocation.

## Technical plan

1. Record parent and nested-worktree status, HEAD, index and file fingerprints.
2. Copy the existing Git metadata into a prepared independent Git directory,
   preserving all local objects, refs, configuration and relevant worktree
   metadata. Preserve the current checkout's index and HEAD.
3. Move the complete checkout by an atomic rename on the same filesystem. A
   full file copy is unsuitable because the checkout is about 18 GB and free
   disk space is about 2.5 GB. A linked-worktree-only move would retain the
   original shared Git dependency rather than create a separate local project.
4. Leave `/private/tmp/paperclip-knowledge-current` as a compatibility symlink
   to Dovix because existing development processes still use that absolute path.
5. Install the prepared Git metadata, reconnect the three nested worktrees and
   preserve removed original Git registrations in an ignored rollback directory.
   Do not delete worktree contents or broadly prune registrations.
6. Repair internal absolute symlinks and the existing Graphify root locator.
   Preserve historical references in documents and runtime data.
7. Verify file fingerprints, Git history/status, nested worktrees, dependency
   resolution and read-only service health. Record the actual validation below.

Migration evidence and reversible Git-registration backups are kept under the
existing ignored `tmp/dovix-migration/` directory. No commit or push is required.
The old project-memory bank is historical context; the canonical Dovix bank is
`codex-Dovix-0ad604734878`. Do not bulk copy memories between banks.

## Execution checklist

- [x] Confirm the actual development checkout and destination availability.
- [x] Inspect dirty changes, nested worktrees, disk capacity and live processes.
- [x] Query project memory and the existing scoped structural graph.
- [x] Preserve file fingerprints and prepare independent Git metadata.
- [x] Move the checkout and reconnect nested worktrees and compatibility paths.
- [x] Verify preservation and local runtime paths.
- [x] Reconcile this document with the completed result.

## Validation and remaining work

The canonical project is now `/Users/ydy1412/projects/Dovix`, with its own
`.git` directory and no Git object alternates. The branch and HEAD remain as
recorded above. All refs, staged changes, pre-existing dirty changes and three
nested worktrees were preserved. The original Paperclip checkout and its two
remaining nested worktrees retain their prior Git state.

Validation performed from the new root:

- `python3 tmp/dovix-migration/relocate.py verify`: all ten preservation checks
  passed; 8,418 tracked/untracked candidate paths had identical content, mode
  and link fingerprints before the intentional README/document updates. The
  original directory inode was retained, including ignored development data.
- `pnpm run preflight:workspace-links`: passed with no stale dependency links.
- `git fsck --connectivity-only --no-dangling`: passed.
- `pnpm --filter @paperclipai/ui exec vitest run src/api/knowledge.test.ts
  src/components/SourcingCatalogPreview.test.tsx`: 2 files, 28 tests passed.
- `http://127.0.0.1:3100/api/health`: HTTP 200 and `status: ok` before and after
  relocation. Existing plugin/PostgreSQL/esbuild process IDs remained present.
- Six internal absolute symlinks were repaired; the existing scoped Graphify
  root locator now points to Dovix. The graph was queried and preserved rather
  than rebuilt, so its prior analysis timestamp still applies.

The intentional documentation changes are the Dovix introduction in README
and this relocation record. Migration snapshots and rollback metadata remain
in ignored `tmp/dovix-migration/`. The old `/private/tmp` path resolves to Dovix
for existing sessions and processes; new development should use the canonical
root. Runtime data and dependency folders remain intact. Review their retention
needs separately before any cleanup. Existing package names and the installed
production service retain the Paperclip identity; UI rebranding is follow-up
work. No browser, OAuth, external publication or fresh agent-run verification
was performed, and no commit or remote push was made.

## Size investigation

`du -k -d 1` measured approximately 18.06 GiB for the complete relocated
directory. The main checkout's 8,418 tracked/untracked candidate paths contain
143.78 MiB of file content; ignored dependencies and development data account
for most of the directory size.

| Item | Measured size |
| --- | ---: |
| Root and three nested worktrees' `node_modules` | about 9.39 GiB |
| Main and compatibility worktrees' Rust `runner/target` build caches | about 2.33 GiB |
| `tmp/marketing-dev/laya-training` models/cache/Python environment | about 2.81 GiB |

These are filesystem directory measurements, not guaranteed reclaimable space
estimates. APFS shared blocks can affect actual reclaimed disk capacity. No
files were deleted during this investigation. Cleanup candidates should first
be reviewed for runtime use and reproducibility; preserve database data,
training results and uncommitted work. Detailed evidence is in ignored
`tmp/dovix-migration/size-breakdown.json`.

The final file review confirmed only README and this relocation record changed
intentionally; the other 8,416 candidate paths retained their fingerprints.
The Dovix identity and verified canonical path were selectively retained in the
new project-memory bank and successfully recalled. Historical banks were not
bulk transferred.

## User-authorized cleanup

The user subsequently requested a complete cleanup and asked whether Rust is
used. Scope is generated, reproducible files; retain source, Git history,
uncommitted work, database instances, backups, import receipts, trained model
checkpoints, the configured Python inference environment and runtime artifacts.

Rust implements the native runner in `packages/paperclip-runner/runner/`.
The package README and Cargo workspace identify process supervision, durable
transport and provider drivers as its responsibility. The main server and UI
remain TypeScript. Cargo output in `runner/target/` includes intermediates and
executables, so preserve the staged runner binaries in `dist/bin/` and confirm
there are no live processes using cleanup targets before removal.

Plan:

1. Fingerprint main/nested-worktree source and trained checkpoints, record Git
   state, disk usage and runtime health, and review open files/path references.
2. Remove both Rust target directories, unused nested-worktree dependency
   installations, the CLI test dependency installation and Python/test caches.
   Preserve the nested worktree source and registrations. Installing dependencies
   again is required before using those worktrees for development. Retarget four
   prototype UI dependency symlinks from the compatibility worktree to the main
   UI installation before removing its dependencies.
   After cache removal, archive inactive `production-backup` and `*-candidate`
   snapshot folders under the existing feature-development directories. Preserve
   every file's content, permissions and symlink target in mode-0600 tar.gz
   archives; verify those values before replacing the uncompressed snapshots.
   Preserve active runtime/release directories in their usable form.
3. Temporarily relocate the Hugging Face download cache and run offline inference
   from the trained checkpoint with an isolated empty cache. Delete only the
   downloadable cache after that check passes; restore it if inference depends
   on it. Preserve its original model/revision inventory for reproducibility.
4. Verify protected file fingerprints, Git states, staged binary hashes, normal
   dependency resolution, selected tests, offline inference and service health.
   Measure the actual resulting directory size and reconcile this record.

- [x] Inspect Rust source/contracts and query memory and the scoped graph.
- [x] Inspect live processes, open files and generated directories.
- [x] Snapshot protected content and remove validated generated files.
- [x] Verify runtime/source preservation and measure the resulting size.
- [x] Record completed cleanup and remaining necessary data.

The existing graph covers the feature work rather than the Rust runner. Its
bounded query did not establish runner dependencies; current Cargo/source and
runtime path checks provide the cleanup evidence. No structural source changes
or graph rebuild is needed for generated-file removal.

Cargo references: [build cache](https://doc.rust-lang.org/cargo/reference/build-cache.html)
and [cargo clean](https://doc.rust-lang.org/cargo/commands/cargo-clean.html).

### Completed cleanup and validation

- Directory measurement: **18.063 GiB -> 7.478 GiB**, a reduction of
  **10.585 GiB (58.6%)**. This reports `du` directory size rather than promising
  an identical increase in physical free space.
- Removed 139 generated directories, including three inactive worktrees'
  dependencies, both Cargo target directories, the CLI test installation and
  Python caches. Removed a further 0.632 GiB Hugging Face download cache after
  successful offline inference with an isolated empty cache.
- Archived ten inactive backup/candidate snapshot directories as
  `*-20261008-cleanup.tar.gz` beside their original locations. Verified every
  regular file's SHA-256, permissions and symlink target before replacing the
  uncompressed directories; archive file permissions are 0600. The archives
  occupy about 0.972 GiB and preserve restoration data.
- Main and three nested-worktree fingerprints cover 32,683 candidate paths.
  All remain identical except this intentional cleanup-document update. HEAD,
  branch, staged changes, dirty/untracked state and Git refs remain unchanged.
  Trained pilot/full checkpoints and both staged runner binary hashes match.
- `cargo metadata --manifest-path packages/paperclip-runner/runner/Cargo.toml --no-deps --locked --offline --format-version 1`: passed. Identifies the
  `paperclip-runner-core` Rust 2021 crate and its `paperclip-runnerd` executable.
  No Rust rebuild was performed after removing build output.
- `pnpm run preflight:workspace-links`: passed.
- `git fsck --connectivity-only --no-dangling`: passed.
- Selected Knowledge API and Sourcing preview Vitest files: 2 files, 28 tests
  passed after cleanup.
- Native local Laya inference from the trained full checkpoint: passed with
  `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, empty `HF_HOME`, and the original
  download cache absent. Used a synthetic input; no account state was inspected
  or confirmed.
- Final HTTP health: 200, `status: ok`. Existing running dependencies, database
  instance directories, configured Python environment, source, model results,
  import receipts and runtime/release directories remain available.

Detailed command/results and inventories are under ignored
`tmp/dovix-migration/cleanup-*.json`; final summary is
`cleanup-final-result.json`. Git history and source were not committed or pushed.
The project memory was queried; the existing scoped graph was queried but did
not cover the Rust runner, whose current manifest and source were checked.

### Reuse and recovery

- Before developing in a cleaned nested worktree, run `pnpm install --frozen-lockfile`
  in that worktree. Keep dependency installations only in
  worktrees currently being used.
- Cargo recreates build output when building or testing the native runner.
  The next Rust build will take longer; staged runtime binaries were preserved.
- For an archived snapshot, extract its tar.gz into the original parent feature
  directory. For example: `tar -xzf tmp/marketing-dev/production-backup-20261008-cleanup.tar.gz -C tmp/marketing-dev`.
  Existing directories must be reviewed before extraction.
- The trained Laya checkpoints support offline inference. Repeating base-model
  training/evaluation requires downloading the original base snapshot again;
  its file/revision inventory is preserved in `cleanup-before.json`.
- No browser, OAuth, production publication or fresh native-agent run was tested.
  No hooks, watchers, retention automation or global tool configuration changed.
