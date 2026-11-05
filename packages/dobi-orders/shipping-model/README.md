# Local shipping-cost model

## Independent parcel-size and weight axes (2026-11-06)

The current schema-3 multimodal trainer supersedes the mixed size/mass rules
below. It uses the two separate axes in
`next1688-physical-policy.json`. The provider's linked
[surcharge guide](https://classic-radium-bbe.notion.site/2da00c6ab94280d8a2a2cb88c0399755?pvs=74)
defines packed edge-sum bands at 100/120/160cm and weight bands at 5/10/20kg.
The [provider page](https://www.next1688.com/Front/Introduction/DlvrMny.asp?CTR_SEQ=2031&gMnu1=201&gMnu2=20107&sCbmYn=N)
also checks freight at >=20kg, >=95cm longest side, or >=160cm edge sum
(>=150cm for Gunsan). Both sources were checked on 2026-11-06. Surcharge
bands include their upper endpoint; the separate freight checks include
their lower endpoint. For example, exactly 20kg is in the 10–20kg band and
also meets the freight check. This is a dated policy snapshot, not a live
tariff feed. Update the versioned data and retrain when the policy changes.

Small/medium/large now describe **parcel edge-sum bands only**. Heavy items
do not increase the size grade. Weight independently reports light/medium/
heavy/overweight. A small heavy item and a large light item keep both facts.
Visual scale is returned separately and never becomes measured packed size.
Quoted product mass is a lower bound, while a photo-derived mass prior stays
uncalibrated. Contents volume, product dimensions and unitless legacy Volume
never become package measurements. Historical records contain 85 positive
Volume values with unverified units and no complete packed dimensions;
therefore this pilot cannot evaluate real parcel-size classification accuracy.

Default fee exports continue to exclude post-shipment measurements. An explicit
offline-label export adds only allowlisted physical outcomes:

```sh
node shipping-model/export.mjs /private/scope/orders.sqlite /private/physical-fees.json fee-with-physical-labels
```

Train with that file using the existing multimodal train command. Recorded
Weight is used to grade **training reference rows only**, with the legacy kg
assumption documented. Images never receive outcomes, customer data or those
labels. Validation, calibration and test queries use photo-context predictions;
their actual recorded weights are used only for evaluation. Missing reference
weights fall back to photo inference. Joint size/weight pools require eight
independent products, then fall back to weight-only, size-only, or shared pools.
Candidate ranges are combined. Calibration conditions on predicted query grades
only with ten independent products; otherwise it uses global residuals.

The existing opt-in estimate API accepts an optional **single reported parcel**:

```json
{
  "items": [{"title": "item", "quantity": 1, "imageBase64": "..."}],
  "category": "unknown",
  "remoteArea": false,
  "parcel": {"weightKg": 20, "dimensionsCm": {"length": 10, "width": 10, "height": 10}, "hub": "other"}
}
```

Weight and dimensions can be supplied separately. Dimensions must be complete.
`hub` is `gunsan`, `other`, or null/omitted. Reported and photo-read values are
not independently verified. Responses add `physicalPrediction.volume`,
`.weight`, `.visualScale` and `.handling`, plus the actual reference pool and
review reasons. A missing dimension remains unknown. Freight risk requires a
manual quote; separately recorded freight is outside the base-fee target.
No surcharge is added on top of historical fee labels. The existing explicit
remote +5,000 behavior is retained. A supplied weight outside training support
returns an unbounded interval. Supplied measurements change the input mode:
the API flags that the reported-parcel mode has not been evaluated for coverage.
If no packed-size labels match, it explicitly reports weight/shared fallback.
Version-1 and version-2 artifacts retain their original predictions.

The original splits and sampling remain unchanged: 1,997 image-complete rows;
train1,885→249, train/validation/calibration/test167/23/22/23 product groups,
split overlap zero. 248 sampled rows have recorded Weight. There are no verified
package-dimension labels. Validation selects k15 and image weight0.60. Reference
weight bands have 110/27/22/17 training groups; groups can span bands.
Photo-predicted light has17 calibration groups; medium4/overweight2 and absent
grades use global fallback (22 distinct groups overall).

On the previously inspected 38-row/23-product test, MAE improves from mixed
routing KRW7,200.26 to **5,488.42**, macro product MAE5,295.43→4,517.68.
The KRW1,000 hit rate drops26.32%→23.68%. 80% targets cover33/38 rows and
20/23 whole groups. 90% targets cover35/38 rows and22/23 groups. Median90%
width rises23,500→23,650, while mean width falls40,084→35,984. All38 intervals
are finite; all38 also require manual freight review because packed dimensions
are missing. The fee aid still returns a base estimate; it does not approve
dispatch or a complete shipping quote. Weight candidate bands
include recorded Weight in32/38 cases (84.21%); the raw photo weight prior
contains it in23/38 (60.53%, including two unbounded priors). Do not call those
priors calibrated weight intervals. These are exploratory comparisons on
historical data, not fresh holdout, future or automatic-quote validation.

Local Python23 and focused Node8 tests passed. Real cached-photo HTTP verified
independent axes, provider boundaries, missing dimensions, malformed parcel400,
unsupported weight, reported-mode disclosure, private metadata, surcharge,
single worker, unchanged isolated orders and v1/v2 compatibility. No new image
calls or downloads were needed. Training peak about64–66MiB, cached Python about46MiB/
0.24s, cached HTTP examples0.10–0.21s; cold remote vision is separate. Private
evidence is under `tmp/physical-shipping/`. PR submission, CI and deployment
remain separate; no operating service, UI, source DB or automatic prices changed.

## Size-first fee model (2026-11-06, experimental)

The current multimodal trainer uses three stages: infer a shipment-size route,
compare products in that route, then calibrate the fee range. The routes are
**small, medium, large, special/unknown**. This is a shared estimator with
size-restricted neighbors, not four separately trained large models.

`size_routing.py` supplies the initial, versioned routing policy, saved in the
private manifest. Visual scale, quoted mass, and complete package dimensions
can affect routing. The mass/length limits are engineering rules, not carrier
tariffs. Product dimensions never become package dimensions. The available
pilot has no complete package-dimension labels, so routing accuracy against
true packed size cannot be measured. Inferred weight can widen candidate
sizes but is not a measured weight label. Quantities with unknown units and
uncertain packing produce review reasons. The policy is editable in the
artifact; change its version and retrain when routing semantics change.

Each size must have eight independent training products to use its own
reference pool. Otherwise it borrows the shared pool. Training price bands
are group-balanced 10th–90th percentiles, not price caps or prediction
intervals. On this pilot they are small KRW 5,500–8,600 (39 groups), medium
5,700–15,600 (50), large 6,900–53,100 (69). Groups may span size classes.
Ambiguous sizes use the union of their raw fee ranges and the largest
candidate calibration guard. Special/unknown sizes and unsupported quantities
return an unbounded interval and `requiresManualQuote: true`.

Per-size residual calibration requires ten independent calibration products.
Only medium has ten in this pilot; small/large have six each and use global
fallback. The API identifies that fallback and does not claim per-size coverage.
Responses add `sizePrediction`, `priceCategory`, `intervalCalibration`, and
`requiresManualQuote`. Metadata adds `sizeHierarchy`. The existing request,
scoped endpoint, original fee model and order state stay compatible. Version-1
multimodal artifacts remain readable; retrain to enable the hierarchy.

Original splits, images and twelve-record sampling are retained. Validation
selects 15 neighbors and image weight 0.35. On the **previously inspected**
23-product/38-row historical test, MAE changes from the pre-routing multimodal
KRW 8,186.05 to **7,200.26**; macro product MAE 6,337.03 to **5,295.43**.
80% targets cover 32/38 rows and 20/23 whole groups. 90% targets cover 35/38
rows and 21/23 groups. Median 90% width is 23,500, but mean width rises from
37,071 to **40,084**. Per-size MAE is about 502/9,022/7,630 for small/medium/large
on only 5/9/9 groups. Small results are encouraging, but medium/large remain
poor. These are exploratory comparisons, not new independent validation or
approval for automatic prices. No test rows have special-size primary routes.

Private evidence: `tmp/hierarchical-shipping/` (candidate, prior manifest,
HTTP proof, tests, resource measurements). No new image-model calls, model
downloads, operating data changes or deployment were needed. Training used
about 64 MiB. Cached real-image HTTP examples took about 0.12–0.25 seconds;
cold image interpretation remains separate. Code is submitted through PR54,
not enabled in the operating service.

## Semantic multimodal fee model (2026-11-05)

The opt-in model reads product photos and text through the existing authenticated **Codex `gpt-6-luna` vision runtime**, then predicts recorded forwarding fees with a small local model. This is a vision-language attribute stage plus a locally fitted estimator, **not a newly fine-tuned vision-language foundation model**. The baseline CNN descriptor model remains available. No local resident LLM, new model download, UI, order change or automatic price calculation is added. A cold image uses the configured Codex account's inference quota; exact image/context/model/prompt matches reuse a private cache. [Codex image and structured-output interface](https://learn.chatgpt.com/docs/cli/reference).

`vision.mjs` accepts product photos, names and HS codes only. It runs with read-only sandboxing and disabled tools, search, MCP/plugin discovery and subagents. Images are untrusted evidence. The schema separates quoted capacity/mass/dimensions from inferred material, bulk and uncertain physical weight priors. Unit/quote checks reject fabricated dimensions and model-number digits. A volume such as 820 mL is never silently converted into measured mass. Inferred priors remain labeled as inference.

```sh
# Request contains items [{title,quantity,imageBase64}], category and optional remoteArea.
node shipping-model/vision.mjs /private/scope/shipping-vision-cache < request.json > vision.json
# The private training manifest has {entries:{imageHash:{model,version,imageSha256,
# contextHash,toolCalls:0,attributes,urls:[originalSourceImageUrl]}}}.
# Attribute extraction must never receive shipping labels or customer data.
python shipping-model/multimodal_model.py train \
  --data /private/fee-data.json --attributes /private/attributes.json \
  --image-cache /private/baseline/image-cache --baseline /private/baseline \
  --model-dir /private/candidate/shipping-multimodal-model
# Attach the vision.json result as request.vision for direct Python inference.
python shipping-model/multimodal_model.py predict --model-dir /private/candidate/shipping-multimodal-model < enriched-request.json
```

Copy reviewed private `manifest.json` and `model.npz` into the existing company/project data folder's `shipping-multimodal-model/`. Scoped `GET /shipping-multimodal-model` and `POST /shipping-multimodal-estimate` reuse board authorization, input bounds, the global single worker, cancellation and shutdown. The server extracts/binds attributes itself and ignores client-supplied `vision`. `shipping-vision-cache/` is scoped to the same data directory. Codex must already be installed and authenticated; missing runtime/login returns a clear failure. No credentials are read by application code or returned to clients. A cold vision pass is bounded to 120 seconds; local prediction to 30 seconds. Cached predictions do not call Codex or fetch images.

Training reuses the original fee product-group split before filtering for complete image attributes and before twelve-record undersampling. Quantile neighbors select at most one row per product group, preserving quantity variety without repeated-product dominance. Validation macro-product interval score selects neighborhood settings. Independent group-maximum calibration combines normalized quantile and absolute residual bands; the 90% band encloses the 80% band. Sparse calibration or unsupported quantity yields an unbounded range. The intervals have **target marginal coverage**, not a per-item guarantee. Historical remote fees are not separated: recorded fee is assumed base; explicit remote=true adds KRW 5,000. Separately recorded collect freight and taxes are outside this target.

The verified pilot processed 301 unique images (zero extraction failures and zero model tool calls). Complete attributes cover 1,997 of 2,674 fee records; 677 incomplete-image records are excluded. Training 1,885 → 249 records, largest product 1,645 → 12. Validation/calibration/test use 23/22/23 independent groups; test remains the same original 23 groups/38 rows. On those rows, MAE changes from KRW 8,784.01 to **8,186.05**; macro product MAE from KRW 7,663.83 to **6,337.03**. The 90% target covers 34/38 rows (89.47%) and 21/23 whole groups (91.30%). Median width decreases from about KRW 27,161 to **23,600**, but **mean width increases** from KRW 27,367 to **37,071**. Rare and heavy goods remain problematic. These small-sample pilot results do not establish statistical significance, future accuracy or readiness for automatic quotes.

The interval guard was revised after inspecting preliminary results on the same historical test groups. The final interval metrics are exploratory remeasurements, not a fresh independent future holdout. Point-model settings remain validation-selected. Private evidence and artifacts: `tmp/multimodal-shipping/` (normalized attributes, report, cached-image HTTP proof and source images). Do not commit them. Change the vision version and retrain when the schema/prompt/feature contract changes. Local, CI, PR and operating deployment results must be reported separately.

This is an experimental quote aid. It does not set order prices, dispatch parcels or train on a schedule. The worker loads only for a prediction, uses one CPU thread and exits. No customer data is sent to an AI provider.

Inputs are product images, customs product names, **HS categories** and quantities. HS codes are not Coupang or Naver category IDs. The source has no separately labeled remote charge: the recorded shipping fee is assumed to be base. `remoteArea: true` adds exactly KRW 5,000, `false` adds zero, and an omitted/null flag leaves the total unknown. The response includes both base and total components, prediction intervals and warnings. Without an image or a supported category, reliability is lower.

## Train in a private candidate directory

Use Python 3.12 with `requirements.txt`, or an existing isolated runtime with those dependencies. Do not alter a shared Python installation. Keep the data, images and model artifacts out of Git. Export only the intended company/project SQLite file. The exporter opens it read-only, emits an explicit product/fee allowlist and recovers image URLs from original XLS files. It excludes recipients, addresses, contact/customs/tracking/order identifiers and measured post-shipment weight. Source product IDs are hashed for grouping, never used as prediction features.

```sh
node shipping-model/export.mjs /private/scope/orders.sqlite /private/candidate/data.json
# Download the URL in encoder.json to /private/encoder.onnx; train verifies its digest.
python shipping-model/model.py train \
  --data /private/candidate/data.json \
  --model-dir /private/candidate/model \
  --encoder /private/encoder.onnx
python -m unittest discover -s shipping-model -p test_model.py
```

Image downloads are sequential, restricted to the original source image hosts, bounded to 5 MiB and four seconds each. HTTP 401/403/429 stops further requests to that host for that run; no login, product-page crawl or URL guessing occurs. Missing-image failures are cached for 24 hours. The immutable 14 MB [MobileNetV2 encoder](https://huggingface.co/onnxmodelzoo/mobilenetv2-12/blob/main/README.md) uses Apache-2.0. Its pinned revision, digest and source are in `encoder.json`. Its ImageNet outputs act as frozen image descriptors; the fee model is fitted locally.

The trainer first creates connected product groups from original product IDs and shared image identities. It separates training, validation, calibration and test groups before undersampling. Only training is capped at twelve shipments per product group, with quantity buckets and a fixed seed. Validation selects regularization/neighbors and modality weights; test labels do not select those settings. Compare a natural-frequency median baseline, title/category control and multimodal estimator. Read macro product MAE as well as row MAE. An independent calibration split supplies category-conditional bands only with at least ten independent groups; otherwise the global band can be very wide. No shipment dates exist for a future-time backtest.

Inspect `manifest.json`: coverage, split sizes, undersampling, evaluation, memory and limitations are part of the deliverable. A trained model is not a guarantee of accurate quotations for rare/heavy products. Ship only a reviewed candidate folder atomically into the scope's `shipping-model/`, retaining the previous folder for rollback. The manifest records the training runtime executable; the service runs that executable without a shell and with a restricted environment. Preserve the model folder with the existing domain-file backup procedure; JSON order backups alone do not contain model weights.

## Predict

```sh
printf '%s' '{"items":[{"title":"cup","quantity":1}],"category":"691110","remoteArea":true}' |
  python shipping-model/model.py predict --model-dir /private/scope/shipping-model
```

Within the existing authenticated company/project `order-management` API:

- `GET /shipping-model`: public model metadata, no interpreter or host paths.
- `POST /shipping-estimate`: the same JSON; each item optionally has `imageBase64` containing raw JPEG/PNG bytes, without a data-URL prefix. No remote URL or filesystem path is fetched by prediction. Up to five items, 5 MiB per decoded image and 10 MiB total encoded payload. An omitted image is reported, not silently synthesized.

Only one worker runs at a time. A second call gets 409; missing artifacts/runtime gets 503; invalid images/inputs get 400. A worker has a 30-second timeout, is killed on client disconnect/shutdown, and cannot write order state. The existing host enforces company/project board access and request-body redaction.
