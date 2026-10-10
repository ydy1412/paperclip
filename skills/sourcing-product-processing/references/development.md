# Product-processing development handoff

Use only for an assigned implementation task. The first useful increment is one
collected product -> editable processing draft -> validation -> operator review.
Build that complete local loop before batch processing or marketplace creation.

## Existing responsibility and evidence

- Dovix's connector: `packages/plugins/plugin-auto-sourcing/src/manifest.ts` and
  `worker.ts`; backend host bridge: `server/src/services/auto-sourcing-plugin.ts`.
  DOB-27 implements six processing tools in source. Check actual runtime discovery:
  the operating plugin keeps its three order-read tools until a verified rollout.
  An internal service or UI action is not automatically an agent-callable tool.
- DOB-27 replaces the source product preview with a scoped processing editor.
  Its browser validation uses isolated synthetic evidence; neither this validation
  nor a source build proves an operating merchant product was processed.
- Auto Sourcing is a separate sibling repository. Resolve its root, read its
  AGENTS.md and `specs/README.md`, then `specs/005-product-publishing/` before editing.
  Its existing `src/AutoSourcing.Core/BusinessDomains/Upload/ProductPublishing/`
  owns draft preparation, validation, persistence, original SKU links and category
  fields. `ExternalIntegration/SourceAdapters/AsideAdapter/PublicationSourceEvidence.cs`
  owns source evidence checks; `ExternalIntegration/Translation/` owns local
  translation/enrichment. Verify these locators against current source.
- Preserve its documented model/source boundaries and validation. Do not duplicate
  product tables in Dovix, create another processing engine, auto-download models,
  add OCR or paid/cloud inference, or weaken evidence checks to get a green draft.

## Implemented source contracts and remaining capabilities

The first increment declares these exact tools. Use them only if runtime
discovery returns them; inspect the returned schemas before calling:

| Tool | Additional input beyond projectId/accountId |
| --- | --- |
| `get-processing-source` | sourceProvider="taobao", allowlisted productId |
| `create-processing-draft` | sourceProvider, productId, unique selected skuIds |
| `list-processing-drafts` | None |
| `get-processing-draft` | draftId |
| `validate-processing-draft` | draftId, expectedRevision |
| `save-processing-draft` | draftId, expectedRevision, name, items, cropPlans |

The host derives company identity from the invocation and checks the active
agent task/project, account binding and explicit project product allowlist.
`auto-sourcing.products.read` and `auto-sourcing.drafts.write` are distinct
capabilities. Old unbound CLI drafts are inaccessible through this API.
Edits identify original SKUs and option ordinals; they cannot set source hash,
owner, price, quantity, currency or remote state. Re-query after a revision
conflict; never overwrite a later operator edit with stale data. After an
ambiguous save, re-query the draft before retrying. Exact maintained schemas:
`processing-tools.ts`, `auto-sourcing-processing-contract.ts` and the local
.NET `ProductPublishing/Dto/ProcessingContract.cs`.

This increment saves crop geometry as a pending plan and always reports
category/required facts as unverified. It does not generate pixel derivatives,
fetch category metadata or mark a draft ready for publication. Those remaining
responsibilities need their own implementation and evidence:

Discover current tools first. Implement only missing responsibilities, reusing
existing endpoints/domain models and the plugin's company/project/account guards.

| Responsibility | Required input | Reviewable result |
| --- | --- | --- |
| Read target category metadata | Authorized target account + candidate/category ID | Real IDs, required attributes/notices/documents and metadata provenance |
| Crop selected source image | Verified image ID + in-bounds rectangle + requested dimensions | Real derivative attachment, original reference, crop metadata |

Specify exact schemas and permissions in local docs before implementing. Preserve
original prices/currencies and option values; reconstruct values in trusted code
from verified source IDs. AI-selected text is a proposal, not an original fact.
Separate source-option translation from category-specific attribute mapping.
Use existing pricing rules rather than inventing conversion rates or margins.

For crop outputs, validate geometry and actual dimensions, preserve originals,
and use the project's attachment/source mechanism. Local derivative paths alone
must not be presented as uploaded or remotely accessible files.

## Cooperation and acceptance

If the assigned task calls for multiple agents, divide concrete responsibilities:
domain/backend draft persistence and guards, UI source/draft comparison, and QA
on fixtures and end-to-end review. Use existing agents only with the authorized
assignment mechanism; this reference does not create hires or choose models.
One owner controls a draft revision/file set at a time. Mailbox is context only.
Review findings and handoffs include real file locations, test results and the
specific next action; do not mark a task done because a message was delivered.

Acceptance scenarios:

- A product with multiple source SKUs keeps each SKU/price/unit mapping after
  Korean option edits; identical translated labels never silently collapse SKUs.
- Changed original hashes, fabricated metadata, ambiguous mandatory facts and
  duplicate option combinations block readiness with specific field reasons.
- Crop output references the original, lies in bounds and has checked dimensions;
  a missing crop tool leaves a visible pending plan.
- A second edit based on a stale revision cannot overwrite the first operator edit.
- Another company/project/account cannot read or modify the draft/media.
- The actual UI shows original/proposed names, image selection/crop, category and
  validation; operator correction persists and reloads through real local APIs.
- No marketplace product/order/shipping write occurs during this review loop.

Record local unit/integration, real UI, tool discovery/assignment and external
provider checks separately. Mock results do not prove a production draft, image
output, registered tool or active agent collaboration.
