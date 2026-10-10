# Knowledge library implementation

## Contract

Implement the full user-approved checklist. Original files, existing tasks,
company isolation and existing agent memory must be preserved. Local repository
documents are canonical; historical Space copies are reference data only.
Review is optional, never a prerequisite for search or agent use.

## Technical plan

Extend the current Artifacts page and work-product APIs for company-scoped
folders, renaming, moving and confirmed deletion. Keep artifact registration
deletion distinct from attachment-byte deletion. Do not use task creation as
folder storage.

Deletion uses the existing authorized issue document/attachment/work-product
mutation endpoints (with their audit logs), never direct storage deletion from
the UI. Resolve a projected ID's source prefix and underlying issue-scoped object
before mutation. Work-product deletion preserves attachment bytes by default;
explicit byte deletion first removes the attachment then its registration. A
partial failure remains visible and can be retried. Document deletion resolves
the actual document key from its ID, not a display title. Confirmations show the
exact selected item; cancel never mutates. New controls sit outside link cards.

Folders extend the existing `folders` table/service/routes with kind `artifact`;
only `artifact_folder_entries` (company/projected artifact ID/folder) is new.
Folder membership does not change task ownership or source content. Existing
folder service owns naming, depth/cycle/parent validation and advisory locks.
Membership writes share its lock, validate company/kind and log board mutations.
Query membership at SQL source filtering before pagination. An additive Drizzle
migration precedes runtime activation. The artifacts list accepts `folderId`;
existing folder CRUD remains canonical, with one artifact membership endpoint.
The Artifacts toolbar uses a folder selector and the existing folder form for
create/rename. New folders are created beneath the selected folder. A parent
selection dialog moves folders; self/descendants are excluded and the server
remains authoritative for depth/cycle checks. Per-artifact selectors move only
membership, including back to Unfiled. The folder ID is part of the list query
and cache key. Counts are not displayed until exact projection counts exist.
Mutation failures remain visible, including inside open forms, and pending
actions cannot be submitted twice by pressing Enter.

Extend the existing Hindsight plugin's source/job pipeline for explicit artifact
imports independent of task completion. Track content hashes and asynchronous
extraction/capture status; retry failed work without duplicate ingestion. Extract
PDF text/page evidence and image observations through a supported document/vision
path; mark uncertain interpretations and retain original attachment references.
Never present unanalysed binary files as analysed evidence.
Explicit import accepts an issue-scoped projected artifact ID, checks current
company/trust/ownership, and queues source assembly without changing task status.
Selected artifacts accumulate within the existing issue source rather than
creating duplicate source rows. Snapshots persist their explicit selections;
reconciliation preserves these sources even while their tasks are incomplete.
Manual jobs (including follow-up refresh) run with automatic collection OFF.
Assembly is queued, failures remain retryable, and unchanged captured hashes do
not create another retain operation. A selected unanalyzed reference cannot be
reported as a completed import. UI shows queue/completion/failure state per item.
Binary analysis uses PDF.js for page-by-page PDF text extraction. Image files and
scanned PDF pages use an explicitly configurable Ollama vision endpoint (default
loopback only) and model; the installed local gemma4:e2b is the initial default.
PDF rendering uses the established native canvas library, not a custom decoder.
Files are read exclusively through authorized SDK attachment reads. Bound work
products include their actual issue-owned attachment. Analysis is limited to
16 MiB, 30 PDF pages and 60,000 extracted characters; partial extraction is
explicitly labeled. No useful output or parser/model failure fails the queued
import rather than creating factual placeholder content.

Keep attachment SHA-256, page numbers, extraction methods and original attachment
links with the snapshot. Hash-keyed company-scoped analysis cache stores redacted
extracted text, not file bytes or credentials, and includes parser/model settings
in the key. Re-read authorized bytes before cache use. Model output is untrusted
source material with a visible interpretation warning, never a command. Reference
previews display this evidence and allow opening the exact PDF page. Node runtime
minimum must match the chosen parser dependency; deployment must include parser
workers and font assets instead of bundling them into an invalid worker path.

Knowledge UI: search first, project selection/name immediately below, optional
confirmation, visible collection control and last successful collection time.
Add authenticated reference data/preview alongside body, evidence and history.
Fail closed on permission/refetch errors and do not expose provider secrets.

Expose real Hindsight entities and relationships, scoped to project banks; graph
selection opens knowledge and source evidence. Do not invent edges from prose.
Graph reads use Hindsight `/entities/graph` in the company/project knowledge bank.
Its native relationships mean co-occurrence, not inferred causal/typed relations.
Require an explicit, authorized project (including Unassigned) and validate source
manifests and retained document inventory/hashes before and after graph reads.
Unmapped provider documents, uncompleted source replacements and revoked source
access fail closed; no provider fields leak into the response. Provider text hashes
use its documented control/lone-surrogate sanitization, preserving valid emoji.
Default visualization is bounded to 500 nodes/1000 edges with visible totals and
partial status, never fabricated edges. Empty projects have an explicit empty state.

Node selection reads native memory lists filtered by entity ID. Edge selection
intersects native memory IDs for both endpoints so its evidence actually mentions
both entities; provider entity names in prose are not used to invent membership.
Only source-bound world/experience facts are exposed. Results retain original
issue/document/attachment links, and relevant readable Knowledge pages can be
opened. Evidence is paginated/sampled with an explicit partial flag. Cytoscape.js
owns layout, zoom/pan and node/edge hit testing. A keyboard-accessible node/edge
list accompanies the canvas; project changes or authorization refetch errors clear
old graph/evidence. Graph/document views share the existing project selector.
Record retrieval separately from explicit result citations, deduplicated by
run/knowledge/type, and show recent agent/task attribution. Retrieval is not use.
Persist usage in the existing plugin database namespace, with a unique company/
run/page/kind key and separate retrieval/citation kinds. Snapshot the page body
hash and actual agent/issue attribution. Insert only against a current company/
project/page binding with that body hash; duplicate calls do not update the last
used timestamp. Citation rows require an actual result artifact identifier.
Tool/event handlers must verify authoritative run/source/result ownership before
calling the store; the store alone is not an authorization boundary. Statistics
are scoped to one company/page, count each kind independently, and expose recent
attribution without interpreting a retrieval as a citation. Schema is additive
and must be validated before activation.
Agent tools expose knowledge retrieval and citation confirmation. Issue scope is
an explicit input, but company/agent/run/project come from trusted tool context.
Verify current issue/company/project/trust and its native orchestration run;
never trust caller-supplied agent or run identifiers. Retrieval returns the
readable page and its canonical company Knowledge URL. Citation confirmation
reads the actual issue document, checks the latest editor is the invoking agent
and modification falls within this running execution, and requires the exact
page URL in its body. A title mention or an arbitrary external URL is not proof
of citation. Other result formats need equivalent source checks before counting.
Citation tool additionally accepts a work-product ID instead of a document key.
Read the actual issue-owned registration and require its company/project/issue,
createdByRunId and modification time to match the current native execution.
Its stored summary must contain the canonical Knowledge link. If metadata binds
an attachment, verify that attachment still belongs to the issue/company. Never
fetch external product URLs or pretend a binary file contains citations; this
records the explicit reference attached to its saved result registration.
Knowledge detail shows separate retrieval/citation totals below its title, with
an expandable recent-use list of kind/time/agent/task links. Query company/plugin/
page independently; do not count human UI reads as agent retrievals. Missing data
has loading/error/zero states, not a fabricated count. Statistics endpoint first
authorizes page provenance, filters recent entries against current task/project/
agent access, and rechecks page access before returning. Permission/refetch
failures hide previously cached use details. UI uses the existing panel/layout
without adding a parallel analytics page.

## Execution checklist

- [x] Artifacts: folder controls, rename and move; unit tests (local code).
  Backend membership, canonical folder kind, pre-pagination filter and UI wired;
  native production migration 0284 applied; isolated API and operating Aside UI verified.
- [x] Artifacts: deletion button/confirmation and default byte preservation;
  unit tests, isolated native API and confirmation UI verified; original bytes preserved by default.
- [x] Imports: task-independent ingestion, PDF/image analysis, evidence,
  idempotency/status/retry; unit tests and actual isolated PDF/image ingestion verified.
- [x] Knowledge: project layout/name; unit tests (local code).
- [x] Knowledge: references and PDF/image preview; unit tests (local code).
- [x] Knowledge: remove mandatory-looking review; unit tests (local code).
- [x] Knowledge: visible collection switch and last collected time; unit tests
  (local code). Only successfully completed capture jobs receive the timestamp;
  historical jobs without a success marker display no completion record.
- [x] Graph: real nodes/edges and evidence navigation; unit tests (local code).
  Isolated native Hindsight and Aside edge evidence proof passed; production activated.
- [x] Usage: retrieval/citation counters and recent attribution; unit tests
  and actual native execution verified: repeated reads/citations deduplicate per run.
- [x] Integration, typecheck/build, Aside browser validation and runtime rollout.
- [x] Final mobile interaction verification and completion audit.

## Validation record

Historical entries below describe validation at that time. The current execution
checklist reflects the latest evidence; isolated functional verification remains
distinct from operating UI/activation proof. No synthetic production imports or
agent execution were performed.

2026-10-06 local implementation: `ui/src/pages/Knowledge.test.tsx` and
`ui/src/api/knowledge.test.ts` cover project selection, optional review, collection
control/error handling, reference preview and authorization-refetch clearing.
Plugin `tests/knowledge.spec.ts` covers pinned/company-safe reference listing,
revoked access and collection timestamp selection. `npm test -- --reporter=dot`
in the plugin: 101 passed, 15 database tests skipped (not integration proof).
Focused UI tests: 24 passed including collection-time rendering.
Plugin and UI typechecks and both repository diff whitespace checks passed. Runtime
deployment and Aside browser proof are not yet performed. Full objective active.

2026-10-06 continuation: deletion uses projected source-prefixed IDs, resolves
document keys and issue-scoped work products, preserves bytes by default and
supports retry after an explicitly selected attachment was removed. Focused
Artifacts/Knowledge/API/delete-dialog suite: 50 passed; card/API/delete tests:
29 passed. UI typecheck passed. The existing canonical `folders` subsystem now
supports `artifact`, rather than a parallel folder tree. New membership service
enforces destination company/kind and source ownership under the same advisory
lock. Folder/schema/artifact projection tests: 22 passed. Direct server and UI
TypeScript checks passed. Additive migration generated:
`packages/db/src/migrations/0295_secret_iron_man.sql` (one membership table only);
not applied to production. Generator-pruned historical snapshot was restored;
no user changes reverted. Folder UI, exact library counts/cleanup and real DB
integration remain unchecked. Runtime still unchanged.

2026-10-06 folder UI continuation: Artifacts now exposes folder creation under
the selected parent, renaming, parent moves and individual artifact membership
moves. Existing folder form reused; failures stay in the form and duplicate
Enter submits are prevented. `ui/src/pages/Artifacts.test.tsx` adds create,
rename, folder filter, artifact move/Unfiled and failed parent-move coverage.
`ui/src/components/folders/FolderControls.test.tsx` covers artifact description,
inline errors and pending Enter suppression. Focused folder UI: 21 passed;
expanded artifact/folder/API/schema/server suite: 79 passed across 9 files.
`pnpm --filter @paperclipai/ui typecheck` and `git diff --check` passed. No
production migration, deployment, real deletion or browser operation occurred.
Remaining imports, binary analysis, graph, usage and live verification retain
their original scope and are not complete.

2026-10-06 explicit-import continuation: Plugin `knowledge-import-artifact`
validates current issue/company/trust and projected document/attachment/product
membership. It queues assembly without changing task status. Selected artifact
IDs persist in source snapshots and survive incomplete-task reconciliation.
Manual capture/refresh jobs can run with collection OFF; unchanged captured
hashes skip retain, pending jobs can be promoted to manual, and refresh reruns
preserve the manual flag. Project moves clear the old captured hash. Shared
`knowledge-artifact-imports` reads report per-item states; hidden/quarantined
tasks are excluded. Per-item retries validate ownership and constrain the
failed-job reset to that source, not all company failures. The new
`ui/src/components/artifacts/ArtifactImportButton.tsx` shares status reads across
cards and shows pending/failure/capture state.

Plugin tests cover incomplete-task selected-only reads, OFF manual imports,
stable queue IDs, rejected scope, unanalyzed binary rejection, source retention,
unchanged-hash suppression, item status and source-scoped retry. Plugin suite:
110 passed, 15 database tests skipped; typecheck and build passed. Initial UI
import/Artifacts/API suite: 22 passed; expanded import/Artifacts/delete/API/
Knowledge suite: 59 passed across 6 files. Both typechecks passed.
PDF/image extraction and synthesis are not implemented by this increment, and
unanalysed selected binary files deliberately fail. Current UI/plugin code has
not been activated in production; no live import or browser proof claimed.

2026-10-06 binary-analysis continuation: PDF.js 6.4.299 extracts PDF page text;
native canvas renders scanned pages and normalizes supported image formats for
Ollama vision. Authorized attachment bytes are read before hash-keyed cache use.
Size/dimension/page/text limits and explicit partial/AI interpretation warnings
are present. Source snapshots include checksums, page numbers, methods and
extracted content, and linked work-product attachments are collected even when
their registration has no summary. Reference UI displays extracted evidence and
links to the exact original PDF page. No source bytes or provider keys are cached.

`tests/knowledge-analysis.spec.ts` uses real generated PDF/image fixtures for the
parser/render/cache/validation paths; model unit tests mock only the provider.
The opt-in live test called the actual local `gemma4:e2b` through loopback Ollama
and verified A/B image content (7 tests passed, 6.17 seconds). UI reference/import/
API suite: 31 passed. Plugin regular suite and final checks recorded below.
Node requirement is now >=22.13.0. The initially considered Node-20-compatible
parser was rejected after npm audit reported GHSA-hq66-cqwq-w95j; the patched
version audit reports zero vulnerabilities. Dependencies remain external to the
bundle so native binaries, PDF workers and font assets remain resolvable. Lockfile
reconciled with the package manifest. Production runtime, real source import,
database integration, graph and usage remain unchecked.

Final binary checks: plugin regular suite 118 passed, 16 skipped (15 DB integration
tests plus the opt-in live test, which was separately run successfully). UI suite
31 passed. Plugin/UI typechecks, plugin build, production-dependency audit (zero
reported vulnerabilities) and both diff whitespace checks passed. Added a real
PDF fixture regression for hitting the text limit exactly at a page boundary:
skipped pages are now explicitly labeled. No operating source files were used
for model smoke tests. Deployment/browser/real-import proof still pending.

2026-10-06 graph UI validation continuation: added
`ui/src/components/KnowledgeGraph.test.tsx` with nine behavior tests covering
native node/edge ID separation and endpoints, explicit project scope, node and
edge evidence requests, original reference links, related-page navigation,
project changes, permission failure hiding cached graph/evidence, canvas failure
with accessible-list fallback, bounded zoom, renderer cleanup and empty state.
Only the canvas renderer/provider are mocked in these UI unit tests; they do not
prove native Hindsight ingestion or browser rendering. Focused Knowledge UI/API/
import/graph suite: 40 passed across four files. Plugin suite: 127 passed,
16 skipped (DB integration and opt-in vision tests). UI and plugin typechecks,
UI production build and repository whitespace check passed. Build retains
existing Vite/CSS/chunk-size warnings. Native graph live proof, usage statistics,
database integration, operational activation and Aside screen validation remain
unfinished; the complete user goal is still active.

2026-10-06 native graph and usage persistence continuation: added opt-in
`tests/knowledge-graph.live.spec.ts`, executed with KNOWLEDGE_GRAPH_LIVE=1 against
the actual local Hindsight server. One live test passed in 15.67 seconds: retained
fixture text, native entities/co-occurrence, shared edge memory and original
issue reference. The UUID-scoped test bank was deleted in finally; production
company banks and source files were not used. SDK source authorization is mocked
in this test, so it is not proof of production board/agent authorization.

Added additive plugin migration `003_knowledge_usage.sql` and store operations
for version-pinned retrieval/citation records, per-run deduplication and separate
counts/recent attribution. Six unit tests cover their query/input contracts.
These tests do not prove SQL behavior on PostgreSQL; integration is pending.
Regular plugin suite now 133 passed, 17 skipped (15 DB, vision live, graph live).
The graph live test was independently run successfully; typecheck passed.
Usage tool/event authorization, actual result citation validation, UI and DB
activation remain unfinished. No deployment or browser validation claimed.

2026-10-06 agent usage tool continuation: `knowledge_read` and `knowledge_cite`
are registered in the manifest and existing Knowledge API setup. Trusted tool
context supplies company/project/agent/run; native issue orchestration verifies
the running execution belongs to that task and agent. Retrieval validates
readable page provenance and records only retrieval. Citation reads the saved
issue document, validates company/issue/latest agent editor and modification
within the running execution, then checks its literal Markdown/autolink target
matches the returned canonical Knowledge URL. Original source access is checked
again after reading the result. Source access now also checks returned issue ID
exactly matches the pinned manifest issue ID. No document is written by these
tools. Other artifact formats and automatic citation event handling are pending.

`tests/knowledge-usage-tools.spec.ts`: eight tests cover successful retrieval and
verified citation, forged run/project, unreadable source, misleading external
URL/title-only mentions, another agent/old result, deduplicated record response
and permission revocation. Plugin suite 141 passed, 17 skipped; typecheck/build
and whitespace checks passed. Native host tool calls, migration application,
statistics endpoint/UI and runtime activation remain unverified/unfinished.

2026-10-06 usage display/database continuation: `knowledge-usage` now authorizes
the page, returns separate retrieval/citation totals and current accessible
agent/task attribution, then rechecks source access. Knowledge detail integrates
`ui/src/components/KnowledgeUsage.tsx` below the title with loading/error/zero
states and expandable recent usage links. UI reads do not count as agent use;
refetch errors and page changes hide cached attribution. Five component tests
plus the existing Knowledge suite passed (23 UI tests); three API tests cover
authorization/redaction/recheck. UI/plugin typechecks and builds passed.

The actual isolated loopback PostgreSQL on 54330 applied all three plugin
migrations in a fresh UUID-named test schema. Added three database tests verify
run/type deduplication, restart persistence, scope/version restrictions and SQL
constraints. First full run found three older failing expectations: one omitted
new manual metadata, one failure fixture omitted captured state, and one exposed
real deletion of old pages while updated sources awaited capture. Corrected
fixtures to reflect current semantics and fixed refresh to preserve old pages,
invalidate pending generation and wait until every current source is captured.
Added a unit regression for mixed captured/pending sources. Full DB-enabled
plugin suite: 163 passed, two opt-in live tests skipped (separately validated in
earlier increments). Test schema was dropped; production plugin migrations have
not been applied. Knowledge links now use the actual UI `project` query key.
Runtime/Aside screen verification and remaining result-format citation checks
are still pending. This is not an operational completion claim.

Deployment preparation: production still runs installed core commit 8f8a0ab7 on
3100; its authenticated Aside u1/master Knowledge screen visibly retains the old
review filter and has no current graph/usage controls. Port only the approved
feature patches into the existing exact-baseline compatibility checkout under
tmp/knowledge-dev/production-compatible, then validate its build/runtime against
the isolated database before touching production. This checkout is packaging
compatibility only, not another canonical document root. Preserve all unrelated
main/original checkout changes. Core artifact-folder migration and plugin usage
migration must precede activating their respective runtime paths. Do not replace
the whole production core with the newer development branch.

2026-10-06 result citation / baseline packaging continuation: citation now
accepts exactly one documentKey or workProductId. Native work-product ownership,
project, createdByRunId, current modification window, saved summary link and any
bound issue attachment are verified. Four tests cover valid registration,
foreign execution, missing attachment, ambiguous target and absent saved link.
DB-enabled plugin suite: 167 passed, two opt-in live tests skipped. Typecheck and
build passed. No external work-product URL or original binary was fetched.

Aside u1/Profile 1 borrowed existing tab 3954BC55620E2689336CF525193BD1B2 and
confirmed authenticated master on the production Knowledge screen. It is still
the previous UI (old review filter, no graph/usage controls); this is explicit
evidence current features have not been deployed. Preserved the existing tab.
Ported only feature server/schema/shared patches and Knowledge/artifact UI into
the existing exact-baseline compatibility checkout. Kept its older artifact API
shape rather than adding unrelated newer agent filters. Existing host/Sidebar
patches from the prior deployment remain intact. Reused locked Cytoscape 3.34.2;
frozen install with ignored lifecycle scripts completed without resolution churn.

Compatible server and UI typechecks passed; focused UI tests 41 passed across
five files; UI production build passed (existing warnings retained). Generated
baseline migration `0284_artifact_folders.sql`, verified it adds only the intended
membership table/FKs/indexes, and migration numbering/safety checks passed.
Applied exactly one pending migration through the normal migration API against
explicit isolated loopback DATABASE_URL on 54330: completed successfully. This
does not apply main-branch 0295 or newer upstream migrations to production.
Operating port 3100 and its DB were untouched. Compatibility runtime startup,
full feature browser validation, backup and production activation remain pending.

2026-10-06 live acceptance continuation: isolated compatible runtime on 3102
started successfully against DB 54330. Actual upload/work-product and folder APIs
verified creation, rename, parent movement, membership assignment and removal.
Manual import of a backlog task with automatic collection disabled completed
Hindsight capture; duplicate requests created one assembly job. Last successful
collection timestamp updated. Real PDF and generated PNG uploads were analyzed
through the native plugin attachment host: PDF text and vision text, page evidence
and SHA256 were persisted. A linked analyzed PDF incorrectly inherited an
"unanalyzed" warning when its attachment warning was absent. Correct the linked
reference warning to follow attachment analysis rather than summary presence,
and add regression coverage before continuing acceptance.

Aside live graph selection returned actual native fact text and original issue/
attachment/work-product links. Screenshot inspection exposed excessive automatic
fit zoom on a small six-node graph: oversized labels overlap nodes. Bound initial,
resize and whole-graph fit zoom to normal scale and include label dimensions in
layout; preserve explicit user zoom. Small graphs (up to 12 entities) use the
library's circle layout with label-aware overlap avoidance; larger graphs retain
CoSE. Add a fitting regression test.

Live acceptance results: plugin suite 167 passed / two opt-in live checks skipped
(native graph and actual vision independently exercised in this runtime). Baseline
UI nine-file feature suite 75 passed, server folder/artifact baseline suite 29
passed. Final graph regression suite ten passed; UI typecheck and build passed.
Plugin typecheck/build and both repositories' diff whitespace checks passed.
Fixed linked-reference warning regression in `tests/knowledge.spec.ts`.

Aside u1 verified deletion confirmation/default original preservation and cancel,
folder selection/rename/move controls, project placement/name, collection OFF and
successful timestamp, native graph six entities/twelve co-occurrence edges, and
edge selection with actual fact/original links. Verified image preview loaded at
natural width 640, and generated status page reference API returned real PDF/image
evidence/checksums. Screenshots remain in Aside sessions
`2026-10-06_jaRBUbVcrCUGXAMh/artifacts/native-graph-evidence.png` and
`2026-10-06_NOJyZhKoU6b2hfFh/artifacts/knowledge-references.png`.

Earlier PDF preview gap (resolved by the validation below): native embedded PDF viewer reports a page thumbnail
but screenshots show a black display. HTTP original is 200, application/pdf,
inline, correct byte length; this is not verified PDF visual rendering. Compared
three approaches: current native iframe, existing task attachment preview (text
only; no reusable PDF renderer), and installed plugin PDF.js/NAPI rasterizer
(already actually renders scanned PDFs for analysis). Prefer reusing authorized
plugin PDF rasterization with bounded page rendering and original download link,
unit tests, and real Aside screenshot proof. Do not add browser fallback or rely
on iframe presence as success. The replacement was implemented in the next increment.

Backlog test IDs and exact file membership are in ignored
`tmp/knowledge-dev/library-smoke-state.json`; HTTP smoke scripts are resumable and
never touch production company. PDF/image capture completed, while page synthesis
continues incrementally (status ready; remaining categories pending). Original
operating 3100/54329 has not been modified. Required next work: finish PDF visual
preview, nonzero native agent-use/citation proof, full mobile/final rollout checks.

Before ending this validation increment, restored the isolated collection setting
to its original enabled=true (API 200), then gracefully stopped only dev runtime
session 70615 (exit 130 after SIGINT, scheduler stopped with zero active jobs).
Fixture DB/state and provider operations remain available for resume. Operating
3100 health is still 200; this increment is not production activation or full
goal completion.

PDF preview implementation: reuse plugin PDF.js and NAPI canvas for one authorized
original page per request. The data bridge must validate readable Knowledge page,
pinned issue/attachment membership, current source checksum and access again after
rendering. Bound bytes to the existing 16 MiB limit, page index to document bounds,
pixels to a 1600px longest edge and returned JPEG to 2 MiB. No model is invoked.
UI displays the returned original raster with previous/next controls and keeps the
original PDF link. Errors/page switches must clear prior pixels; unit tests cover
real PDF rasterization, access/scope rejection, navigation and failure states.

Native usage acceptance: use the built-in process adapter only in the isolated
KNO test company. A deterministic local test process uses a temporary native agent
credential, native checkout/result document API and plugin tool gateway. No AI
model/subagent delegation or provider spend is involved; do not fabricate agent
or heartbeat rows. Verify two reads and two citations yield one of each, and that
recent attribution matches the actual native run/agent/task. Preserve fixture IDs
for browser inspection and leave the operating DOB company untouched.

The built-in process adapter intentionally does not mint a local JWT. Its first
attempt ended before API access; the earlier unassigned task was also correctly
cancelled by native ownership gating. Compared native process credentials,
HTTP adapter (also no JWT), and local AI-driver adapters (would change the tested
execution path or invoke a model). Use a native temporary agent API key brokered
only in memory through a mode-0600 Unix socket. Broker verifies actual running
company/agent/issue scope; revoke the key and remove the socket in finally. No
secret in adapter config, fixtures, Git or chat; no permission policy bypass.

Validation increment, 2026-10-06: PDF raster preview is implemented in
`knowledge-analysis.ts`, `knowledge-api.ts` and `KnowledgePdfPreview.tsx`.
The actual PDF bridge returned HTTP 200, an original-page JPEG at 1600x229,
matching checksum and one-page bounds. Aside u1 verified rendered pixels, original
links and disabled boundary navigation; screenshot:
`2026-10-06_5QuiVVOqT5usmZm7/artifacts/knowledge-pdf-raster.png`.
No native browser PDF viewer or AI interpretation is used for the preview.

Native usage proof succeeded through the process adapter, native API-key auth,
issue checkout, plugin tool gateway and saved issue document. Run
`0d06da2f-ddf7-42ba-b5ae-881616499ea2` exited 0; two reads and two citations
persisted exactly one retrieval and one citation for that run. Actual native
agent/task IDs and document evidence match. A separate host-generated continuation
performed one additional retrieval, then correctly failed the document revision
guard; total UI counts are therefore two retrievals / one citation, not 1/1.
This is run-level integration evidence, not evidence of an AI model understanding
the knowledge. The resumable fixture now uses run-specific document keys and a
done disposition to avoid accidental replay/unfinished native handoffs.

The initial failed process was restored only through the native recovery API with
truthful recorded outcomes. Default-deny tool access was retained. Compared tool
profiles, policies and connection grants; a test-only default-deny profile allowed
exactly `knowledge_read` and `knowledge_cite` for the isolated agent. The agent is
now paused, the profile unbound, and all temporary API keys revoked; Unix socket
removed. The operating DOB company and its policy were not modified.
API verification script: ignored `tmp/knowledge-dev/library-usage-verify.mjs`.
Aside u1 verified nonzero usage and recent actual agent/task attribution; screenshot
`2026-10-06_s4jAfN3HT8wdOxpP/artifacts/knowledge-native-usage.png`.

Current validation: isolated PostgreSQL plugin suite 170 passed / two opt-in live
checks skipped, UI eleven-file feature suite 110 passed. Plugin and compatible UI
typecheck passed, canonical/plugin diff whitespace checks passed. Full operating
activation, mobile viewport verification and final completion audit remain open.

Final design-token gate identified six graph color literals and three arbitrary
layout/height classes. Move those values into the existing `ui/src/index.css`
token layer and use token-derived Cytoscape colors plus named responsive classes.
Add a regression for token colors and canvas classes; revalidate the gate and
feature tests before rollout. Operating instance remains untouched.

Token correction completed: all design-token gates clean, graph regression 11
passed, server folder/artifact service and route suite 29 passed; compatible UI
and plugin production builds passed (existing Vite/CSS/chunk warnings retained).
The isolated dev server was gracefully stopped with SIGINT, session 11027 exit
130 and scheduler activeJobCount=0. Operating authenticated 3100 health remains
200. Test databases/files are preserved; no operational deployment is claimed.

Rollout packaging plan: construct an ignored candidate runtime under
`tmp/knowledge-dev/library-runtime` from the installed 2026.1001.0 server,
database and shared packages. Reuse installed dependencies, but copy rather than
mutate those three packages. Overlay only the listed compiled feature files and
built UI. Require the candidate migration journal to retain the exact installed
prefix and append only 0284. Validate this installed-layout candidate on isolated
3102/54330 before any operating copy or migration. Production backup and preserved
identity/config snapshots remain required before apply. No broad core upgrade.

Aside capability investigation: current page API has viewport reads but no
documented setter; native Chrome windows API explicitly permits reads only, not
window mutations; Aside visual-browse provides viewport-local actions but no
resize method. Do not bypass those restrictions with CDP, another browser or raw
window APIs. Desktop rendering is verified; a genuine mobile viewport remains an
unverified gate unless an authorized Aside-supported path becomes available.

Installed-layout validation passed: candidate runtime overlays 13 feature files;
immutable plugin release installs with SDK 2026.1001.0 and zero dependency audit
findings. Native soft-uninstall/reinstall on 3102 preserves plugin ID, settings,
three sources and original PDF rasterization. Aside u1 candidate graph renders
six entities/twelve native edges at 1440px with no horizontal overflow; screenshot
`2026-10-06_Fn23Aip5seL4misM/artifacts/knowledge-packaged-graph.png`.
UI full feature suite now 111 passed. Installed shared/db/server compilation passed.

Fresh operating backup `knowledge-library-preapply-20261006-070100.sql.gz`
(1,177,623 bytes) restored into an owned isolated database on 54330. Company=2,
agent=5, user=2 and plugin-config=1 counts and complete-row hashes match the live
operating database. Restore database was dropped in finally; operating database
was read-only during verification. Compressed backup integrity also passed.
No active/queued operating agent runs and no running plugin jobs were observed.

Operating apply plan: archive the present allowlisted runtime files and UI with
mode-0600 backup, preserve the instance config hash and identity snapshots. Copy
the immutable plugin to the established releases directory. Through the native
DB migration interface apply only inspected pending 0284, overlay the compiled
allowlist/UI and hot-restart the existing service without changing its settings.
Use the native instance-admin plugin lifecycle without purge, preserving plugin
identity/config and knowledge. Recheck counts/hashes, authenticated Knowledge and
artifacts endpoints, rendered operating UI and service health. On failure restore
the archived files and old plugin path through the same lifecycle, retaining
additive tables; do not restore the entire DB or alter accounts automatically.

Final operating rollout succeeded on 2026-10-06. Thirteen allowlisted compiled
feature files and the compatible UI are installed on the original 2026.1001.0
core; migration 0284 and plugin migrations through 003 are applied. Native plugin
lifecycle installed immutable `hindsight-0.5.0-library-ded483ed` with the same
plugin ID, ready status, one source and all five existing knowledge pages.
Complete-row identity/config hashes match: companies 2, agents 5, users 2,
plugin configurations 1. Existing instance config is unchanged. Authenticated
Aside verified Knowledge project controls, optional confirmation, collection
switch, graph tab and Artifacts folder controls on operating DOB. Screenshots:
`2026-10-06_xfaR1mKYQA5NBbVi/artifacts/knowledge-production-library.png` and
`2026-10-06_Xw6JDI1Kp1e4UuCJ/artifacts/artifacts-production-library.png`.
The runtime archive is readable (480 entries); actual database restore was
verified before apply. No post-deployment rollback or synthetic operating data
creation is claimed.

User explicitly authorized another browser for mobile verification only.
Fresh isolated Chrome contexts on test 3102, without operating cookies/token,
verified 390x844 and 768x1024. Knowledge list, reference detail, graph/evidence,
Artifacts and delete dialog all had document width equal to viewport width and
no horizontally clipped main controls. Actual image 640x240 and PDF page raster
1600x229 rendered; one-page previous/next buttons were disabled. Native graph
canvas contained 8,374 / 14,272 nontransparent pixels; selecting a relation
displayed six original evidence links. Usage showed two retrievals / one citation
across the documented executions. Delete confirmation opened and cancelled with
original-file deletion unchecked. No mobile code corrections were needed.
Ignored runner/report: `tmp/knowledge-dev/library-mobile-smoke.cjs` and
`tmp/knowledge-dev/artifacts/mobile-verification.json`; screenshots live beside it.

Final requirement audit: every requested checklist item has focused unit coverage
plus the integration evidence recorded above. Latest suites: plugin 170 passed
(two opt-in live tests skipped, their integrations verified separately), UI 111
passed, server folder/artifact routes/services 29 passed. Compatible shared/db/
server/UI and plugin typecheck/build passed; design-token and diff whitespace
checks passed. Usage counts explicit authorized `knowledge_read` / `knowledge_cite`
tool execution, not generic memory recall or a human opening the page. Automatic
saved-result scanning and historical backfill are not claimed or required here.
After mobile verification the owned candidate server 3102 was stopped gracefully
(exit 0, scheduler activeJobCount 0). Operating 3100 health returned HTTP 200 and
the expected immutable plugin release remained ready. Final whitespace checks
passed in canonical Paperclip and Hindsight repositories. Operating servers and
existing user data remain running/preserved.
