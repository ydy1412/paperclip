---
name: sourcing-product-processing
description: Process collected sourcing products into Korean sales drafts with traceable option names, image crop plans and verified category metadata; also guide development of missing processing tools. Use for sourced-product preprocessing and draft review, not marketplace publication or order operations.
---

# Sourcing product processing

Produce an editable, reviewable sales draft from selected collected products.
Keep original evidence separate from processing choices. A skill supplies rules;
it does not implement tools, install itself on agents or authorize publication.

## Choose the task mode and real tools

- **Product operation:** discover the assigned Auto Sourcing plugin tools and
  their schemas. Obtain the actual project/account/product and selected SKUs.
  Use only tools really returned by discovery. If evidence, draft-write, category
  or crop actions are missing, report that specific gap and preserve the proposed
  processing draft; do not call invented tools or change application code merely
  to complete an operating request.
- **Tool development:** when assigned to implement processing, read
  [Development handoff](references/development.md), the actual target repo's
  rules/specs and existing publishing domain. Implement the requested missing
  capability with tests and update its local contract. This mode does not itself
  launch another agent or authorize changing unrelated services.

The DOB-27 source increment implements source read, scoped draft creation/list/
read/save and validation. Its exact contracts and deployment boundary are in
[Development handoff](references/development.md). The operating plugin still
has the prior order-read tools until that increment is deployed and discovered.
Category metadata and actual image cropping remain separate missing capabilities.

## Process a selected product

1. **Evidence:** read hash-verified original product files and exact SKU records.
   Retain product/SKU IDs, source URL, source text, image IDs/URLs, prices/currency,
   units and evidence locators. A database row alone does not prove original file
   provenance. Reject changed evidence; do not scrape new inputs silently.
2. **Product and option names:** create readable Korean names from source facts.
   Preserve dimensions, quantities, material distinctions, compatibility and SKU
   combinations. Do not invent brands, certifications or product claims. Never
   merge different SKUs because translations match. Flag ambiguous translations
   and duplicate purchase-option combinations for review. Keep original values
   next to proposed values and enforce limits from actual target metadata.
3. **Images:** choose the representative source image for the product/SKU. For
   cropping, record image reference, original dimensions, crop rectangle, output
   dimensions and purpose. Retain original files and link derivative outputs to
   them. Do not hide a variant, alter product geometry/color or invent accessories.
   Use an available authorized image tool and verify the real output. Without
   such a tool, record a crop plan as pending, never as a completed image edit.
4. **Category and required facts:** use real provider category metadata, exact
   category IDs and required option/notice/certification/document fields. Show
   candidate categories and why they fit; record uncertainty rather than inventing
   an ID or satisfying missing fields with unrelated source text. Unknown mandatory
   facts remain blocking review issues. Respect existing account/category rules.
5. **Draft and review:** save through the existing draft capability when available,
   preserving operator edits and checking revision conflicts. Validate evidence,
   SKU mapping, units/numbers, image outputs and required metadata. Report draft
   ID, changed fields, original-to-processed differences, actual checks and pending
   decisions. No available save tool means a proposed draft, not a persisted one.

The result should let the operator compare source and proposed names/images/
category, amend them and understand each blocking issue. Do not submit products
to a marketplace, alter orders/shipping or start paid generation as a consequence
of processing. Use the user's existing authorization for any later action.

## Collaborate and continue

Use the deployed Paperclip skill's collaboration contract when available.
Messages carry evidence and review context; explicit task assignment carries
execution. Give collaborating agents clear product/field/file boundaries so they
do not overwrite the same draft revision or source files. Share verified links
and unresolved decisions, not credentials or complete private source dumps.

Before handing off, record goal, changed files, completed/in-progress work,
acceptance criteria, test commands/outcomes, decisions, unresolved inputs,
blockers and next actions. Agents use `checkpoint_only` for their own assigned
task if the continuity API exists. If absent, retain the same context in the
authorized task document/comment and follow its existing lifecycle.
