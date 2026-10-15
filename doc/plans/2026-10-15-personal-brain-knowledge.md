# Personal Brain knowledge workspace

Implement the approved integrated mockup: Knowledge → Library / Ask / Graph.
Personal Brain is the default vault; the existing company Paperclip knowledge
remains a separate selectable vault. Do not migrate or re-ingest either store.

Use a user-owned Apps MCP connection for Personal Brain and existing plugin
bridges for Paperclip. All requests retain company/user/connection scope. Add
read-only library/detail/graph/file tools to the Personal Brain Gateway; preserve
native recall/reflect provenance and current source revision checks. Documents,
projects, and stored source references can form typed graph edges; conceptual
co-occurrence edges must come from Hindsight and verified native documents.

The three routes share vault/project selection, document links and source detail.
Library distinguishes originals/derived notes. Ask shows evidence independently
of synthesis and labels generated/partial results. Graph has keyboard-accessible
selection and original evidence. Empty/error/loading/auth states never present
sample data as operating results. Use existing UI primitives and visual tokens.

Validate scoped reads, revoked/foreign grants, stale references, file bytes,
pagination, navigation and failure states. Run focused tests before broader
checks, build the candidate and verify actual browser flows on an isolated
runtime. Submit both repository PRs, review/check/merge into dev and deploy the
verified feature without replacing the installed core's unrelated features or
migration journal. Preserve a runtime/UI backup and record exact commits.

## Implemented behavior

- `/knowledge`, `/knowledge/ask`, and `/knowledge/graph` share the selected
  vault and project. The main sidebar and mobile navigation expose all three.
- Personal Brain uses the current user's active Apps grant. The proxy checks
  company access, board identity, `tools:use`, credential ownership, and an
  active read-only catalog action before and after each provider call.
- Personal Brain original notes and derived notes remain distinct. Source links
  open the current original. File responses check the revision, byte length,
  and SHA-256; executable formats download instead of rendering inline.
- The existing Paperclip library and graph remain available in their own vault.
  Legacy document URLs still select that vault. Its search uses the existing
  full-text index; source-based answer generation uses Personal Brain.
- The graph shows stored project membership, derivation, and verified native
  entity evidence. It does not invent conceptual links.
- Personal Brain Gateway PR [#3](https://github.com/ydy1412/personal-brain-server/pull/3)
  supplies the five library/graph/file read tools. Its deployed dev commit is
  `143f69d4bd8d1b5f6c1c78f76937a73bf6a1b0bc` (Gateway 0.3.0).

## Verification and rollout boundary

The focused UI and service tests cover default vault selection, original links,
scope navigation, answer references, failed refreshes, setup states, user grant
ownership, catalog quarantine, and file bytes. Existing knowledge, graph,
preview, navigation, and routing regressions also passed. Workspace type checks,
the complete build, and UI token gates passed.

The native compatible API harness used the real user grant and public Personal
Brain endpoint. It read four documents, opened a document, and read five graph
nodes with six edges. A foreign user and a mutation tool each returned 403.
Native recall returned one result; reflection returned a nonempty answer and one
source reference. The harness actor is a test fixture derived from the valid
board session; it is not browser authentication evidence.

Aside u1 checked the actual React components with clearly marked Storybook
fixtures: list to original, question to source, graph to related document, empty
and connection error states, light/dark presentation, and 390px iframe layout.
The three mobile views had no horizontal overflow. The checked interaction flow
reported no window error, unhandled rejection, failed fetch, or failed resource.
This responsive check is not a physical mobile device test. Captures and native
read receipts are in the ignored `tmp/knowledge-brain/` task directory.

The installed server is an older managed release with prior feature overlays.
Rollout must copy only the new knowledge route bundle, route registration,
private request-log policy, and a UI built on the currently installed compatible
UI source. Preserve heartbeat, plugin, order code, forwarder records, and the
database migration journal. Require idle work queues and verified database/UI
backups before the guarded service restart. Record the exact merged dev commit
and file hashes in `tmp/knowledge-brain/deployment.json`.

The old installed Apps setup created the task's new personal key with company
ownership. The stricter proxy correctly refused it. Reconnecting that task-created
connection with the existing authorized read key through the current credential
helper created a fresh user-owned secret and synchronized its declarations. The
old secret's ownership and all agent assignments were preserved. Do not weaken
ownership validation or adopt another user's secret to work around this case.

Operating browser verification remains separate: Aside observed its password
manager as locked and did not complete Paperclip sign-in. Do not import a CLI
session into the browser or bypass that lock. Authenticated operating API reads
and a working fixture UI do not prove the operating browser login flow.

## Host regression limits

The broad regression run is not green. The complete UI group reported 7,590
passes and six failures: five `SourcingCatalog` cases also fail on the clean
base dev commit `6e3c4aab`; the `HoneycombRunLink` cases pass in isolation on both
the base and this feature. Four sourcing server cases also fail on that base.
The shared, skill-catalog and database groups passed 845, 20 and 161 cases.
Adapter checks include a host precondition failure: the installed Claude CLI is
2.1.81, while an existing isolation test requires at least 2.1.207. Other broad
checks exceeded cold-import or five-second time budgets under concurrent load.
Do not update the global CLI or change unrelated test assertions for this UI
change. New knowledge tests, native reads, compatible import/build checks and
the checked browser interactions passed; they do not imply a full-suite pass.
The general server groups were bounded after about 20 minutes once these
independent failures and host limits were established. That run also recorded a
Slack callback ordering failure; its chat module is unchanged. The remaining
broad run was interrupted gracefully and is not complete. No global CLI upgrade
or unrelated feature/test fix is included in this PR.

An initial attempt could not start the newly installed Postgres dependency. Its
macOS ICU and other packaged library aliases were missing. Restoring the 17
existing relative aliases from the working base dependency fixed `initdb`, and
the three event-sequencing cases then passed. This repair only changed ignored
`node_modules` files. It did not change the installed service or its database.

PR [#36](https://github.com/ydy1412/paperclip/pull/36) contains this feature.
The fork currently has no PR workflow run or check result for this head; CI is
unverified, not passed. The final PR description and the local deployment receipt
record the review and rollout outcome. The managed-runtime rollout remains a
compatible feature overlay on core `8f8a0ab7`; it is not a full core upgrade.

## 2026-10-16: Baalda-style file explorer

The approved follow-up replaces the library's classification rail and card list
with a real folder tree and a tabbed document workspace. Keep Library / Ask /
Graph navigation. Use existing Baalda IDs and paths; no Dovix folder database.
Show empty folders, create/upload/rename/move/trash actions, keyboard navigation,
resizable panes, Markdown source/preview/split modes and generated-source links.
The default write location is Inbox. Inbox/PreProcessed descendants are writable;
Processed and system roots remain protected. Generated notes can create an
editable copy with original ID/revision provenance.

The Gateway adds tree, trash and explicit management tools. Dovix separates read,
write and multipart upload routes. Every management call requires the caller's
active company/user grant and an active write/destructive catalog declaration,
checked again after the provider response. A read key is never upgraded. Existing
connections need refreshed declarations and an explicitly authorized write key
or owner OAuth grant before management actions become available.

All deletes move actual resources into reserved Inbox/Trash. The Gateway journal
keeps original paths and move/recovery receipts; native moves preserve all file
and folder IDs and binary bytes. Ordinary listing/search/processing excludes
Trash. Conflicting restore names or missing parents require a new name/location.
No permanent-delete feature is added. Failed move acknowledgements are reconciled
on the next management request without repeating an already completed move.

Edits use the current revision. Local drafts are scoped by verified owner,
company, vault and document. Debounced writes also flush on unmount/page hide;
empty edits survive. Explicit server save/readback is distinct from a browser
draft. External revisions preserve local text and require conflict resolution.
Tabs ask save/discard/cancel before closing a dirty document.

Gateway-first rollout is required. This implementation is submitted as separate
feature PRs into dev. PR creation is not a deployment receipt. Retain the existing
managed-runtime compatible deployment and backup boundary described above.

### Explorer verification

- Gateway PR: https://github.com/ydy1412/personal-brain-server/pull/4
  (head `d8a0d3eb01b01b75bfafe424f3b2f007f07f515e`). Its GitHub test check passed.
- Gateway: 67 Node cases, three Python compatibility cases and syntax checks pass.
  Native disposable-folder checks passed for empty folders, revision conflicts,
  PNG byte/hash readback, subtree moves, and trash/restore with stable IDs. The
  script cleaned up its created notes, files and subfolders.
- Dovix: 61 focused cases cover the explorer, existing knowledge UI/API/graph,
  proxy ownership, read/write separation, revocation, conflict and upload paths.
  Whole-workspace typecheck and build pass. Final UI build and token gates pass.
- Aside u1 exercised the actual React components with explicitly labelled,
  disposable Storybook fixtures: create/edit/preview/button and keyboard save,
  tabs, generated copy, F2 rename, drag/drop move, Delete/trash and restore.
  Native storage proof and fixture browser proof remain distinct.
- Captures exposed a desktop panel-unit error and mobile wrapper sizing overlap.
  Both were fixed and rechecked: desktop explorer 294/1184px; 390px iframe has
  no horizontal overflow, all fixture rows fit, and the document reader is
  reachable by vertical scrolling. The tree's inner rows are 176px high; the
  outer mobile explorer panel has the viewport-based height. Evidence is in
  ignored `tmp/knowledge-explorer/`.
- The broad `pnpm test:run` was started and then interrupted during its unrelated
  general-server group. The repository timing manifest records 646 suites with
  53.1 minutes of serial cost for that group alone. This run has no full result
  and is not a pass. Existing host/baseline limitations above remain separate.
- Source/diff review and Graphify relation checks were completed. No source
  originals, running managed server, credentials or connection permissions were
  replaced. No master promotion or operating deployment is part of these PRs.
