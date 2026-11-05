# Shipping-cost estimator

## Separate parcel size and weight (2026-11-06)

The user approved separate volume/parcel-size and weight axes. Supersede the
mixed size/mass routing below. Use the provider-linked current surcharge guide:
https://classic-radium-bbe.notion.site/2da00c6ab94280d8a2a2cb88c0399755?pvs=74
and https://www.next1688.com/Front/Introduction/DlvrMny.asp?CTR_SEQ=2031&gMnu1=201&gMnu2=20107&sCbmYn=N
(checked 2026-11-06). Store the policy as data, version it in the artifact, and
do not interpret past fees as a current tariff quote or add a second surcharge.

Parcel-size bands use packed edge sums at 100/120/160cm, independently of
weight bands at 5/10/20kg. The provider separately flags freight at >=20kg,
>=95cm longest side, or >=160cm edge sum (>=150cm for Gunsan). Upper-inclusive
surcharge bands and inclusive freight checks have different boundary semantics.
Keep this distinction visible. Unknown hub/packing limits the result.

Add optional reported single-parcel weight/dimensions to the experimental API.
Photo-read product mass is a lower bound, not packed mass. A visual mass prior
remains uncertain; product dimensions and contents volume never become parcel
dimensions. Without packed dimensions, return unknown parcel size and retain
visual scale as a separate description. Keep the two axes independent.

Use historical Weight as an offline label/reference grade only, with its legacy
kg assumption stated. Never pass it into the image model or use a held-out
shipment's actual weight to route that query. Export physical labels only via
an explicit opt-in allowlist; default fee exports stay unchanged. The DB has
85 positive Volume values with unverified units and no complete parcel
dimensions. Do not invent volume-class ground truth from them.

Use joint reference pools when supported, then weight or size pools, then the
shared pool. Calibrate on predicted query grades. Preserve original product
splits, sampling, v1/v2 artifact compatibility and the unchanged source DB.
Freeze policy before fitting, compare the same historical test with prior
models, and report finite-interval coverage as well as manual-quote rates.
Verify heavy-small and light-large parcels, exact official boundaries, unknown
measurements, no outcome leakage, real cached HTTP, resource use and PR state.
No production deployment, fresh image calls, UI or automatic pricing is part
of this experiment.

### Verified independent-axis pilot

- Official policy is a dated JSON data file, not the old invented3/15/50kg or
  35/70cm thresholds. The two grades stay independent, with freight checks
  reported separately. No current surcharge is added to old fee labels.
- Default export privacy remains intact. The explicit physical-label export
  preserves every original fee record and feature while adding offline Weight
  labels and unit-unknown Volume. The sampled249 rows include248 Weight labels;
  no complete package-dimension ground truth is available. Query paths cannot
  read historical outcome labels. Original splits/sampling remain unchanged.
- Validation selects k15/image weight0.60. Same historical38 rows/23 groups:
  MAE7,200.26→5,488.42 KRW; macro product MAE5,295.43→4,517.68. The1,000KRW
  hit rate decreases26.32%→23.68%. 80% target33/38 rows·20/23 groups;
  90% target35/38·22/23. Median90 width23,500→23,650 KRW; mean40,084→35,984.
  All38 intervals are finite, but all38 require manual freight review because
  packed dimensions are missing. No fresh holdout or per-product guarantee.
- Weight candidate grades cover32/38 recorded weights; raw photo weight priors
  cover23/38, with36 bounded priors. Photo priors are not calibrated weight
  intervals. Parcel-size accuracy is unmeasurable without actual package data.
- Python23 and focused Node8 passed. Real cached-image HTTP verifies independent
  axes, policy boundaries, missing dimensions, unsupported weights, reported
  input-mode disclosure, explicit surcharge, privacy, worker bounds and isolated
  order preservation. V1/V2 predictions remain unchanged. Local training about64–66MiB;
  cached Python46MiB/0.24s and HTTP about0.10–0.21s. No new vision calls.
  Evidence: tmp/physical-shipping/. Code/PR/CI/merge/deployment stay distinct.

## Staged size and fee experiment (2026-11-06)

The user approved size routing before price estimation: small, medium, large,
and special/unknown. Reuse PR54 and its image cache. No new vision calls or
resident models are needed. Keep the current operating estimator unchanged.

Use a shared nearest-product estimator with size-restricted reference pools;
borrow the shared pool when a size has fewer than eight training groups.
Learn descriptive price bands from training groups only, with equal total
weight per product. Do not hard-code a small-item price ceiling. Ambiguous
sizes must use the union of candidate ranges. Unknown/special sizes and
unsupported quantities must not return a finite promised range.

Size labels are **inferred routing labels**, not measured packaging classes.
No complete package dimensions are available in the pilot. Version the
editable routing policy, keep product/package measurements distinct, and
report review reasons. Verify category calibration only with at least ten
independent groups; otherwise label the global fallback and its marginal-only
coverage limitation. Preserve original splits and training undersampling.

Before fitting, freeze the routing/selection procedure and retain the previous
multimodal artifact for comparison. Select settings with validation only.
Report point error, 80/90 coverage, width, and performance per inferred size
on the same historical test groups. These groups were already inspected;
this is exploratory comparison, not fresh validation. Verify routing boundary
cases, sparse fallback, mixed-size unions, actual cached-image HTTP output,
privacy, unchanged orders, time and memory. Submit the update to PR54; do not
merge, deploy, or connect automatic pricing as part of this experiment.

### Verified staged pilot

- Reused all existing attributes; no new image inference or source fetch.
  Original splits and 1,885→249 training sampling remain unchanged. Training
  references have small39/medium50/large69/special13 groups; some groups span
  classes. Price bands come only from these training rows, with equal total
  weight per product. Package-size labels remain inferred, not ground truth.
- Validation selects k15/image weight0.35. Calibration has small6/medium10/
  large6/special1 groups (22 distinct overall). Only medium supports category
  calibration; ambiguous candidates also retain any global fallback guard.
- On the same historical 38 rows/23 groups: MAE8,186.05→7,200.26 KRW;
  macro product MAE6,337.03→5,295.43. 80% target32/38 rows,20/23 groups;
  90% target35/38 rows,21/23 groups. Median90 width23,600→23,500 KRW,
  but mean width37,071→40,084 KRW. No fresh holdout or general accuracy claim.
  Medium/large remain weak. No special-size primary routes occur in this test.
- Local training peak64.4MiB. Cached actual fan/chair/shampoo HTTP returned
  medium/large/small, descriptive price bands, candidate pools, fallback mode,
  nested intervals, explicit remote surcharge and unchanged isolated orders.
  These examples are functional demonstrations, not extra accuracy samples.

## Semantic multimodal fee experiment (2026-11-05)

The user requested a multimodal **shipping-fee** model after the weight-only interval experiment proved too wide. Use the original fee target and untouched source DB. The previous CNN image descriptor already made the model technically multimodal, but it did not explicitly read printed capacity/dimensions or product type. Add a bounded vision-language extraction stage using the existing authenticated Codex runtime, followed by local fee fitting. Do not install or start a resident local LLM. Product images/title/HS are the only remote input; never include labels, customer data, identifiers or shipping history in extraction prompts.

The vision function runs with tools/MCP/plugins/search disabled and returns schema-constrained attributes. Preserve quoted visible evidence and distinguish an inferred physical prior from an observed measurement. Validate units, numeric quotes, image hashes and model/prompt version; cache by exact image bytes and context. Reject invented or ambiguous dimensions and unknown facts instead of coercing them. Process original public assets sequentially, stop on denial and never open supplier pages. Start with the existing source images and reuse caches.

Split original product/image groups before fitting or undersampling, retaining the prior seed and held-out fee groups for a paired comparison. Only training is capped per product; calibration gives one maximum residual per independent group. Fit semantic image/text/physical features using validation only. Compare point MAE, macro-product MAE, 80/90 target coverage and interval width against the original image-descriptor and median baselines. This remains a pilot with unknown historical routes/membership/weight semantics, not a promise of accurate fees. Keep the separate weight PR unchanged. Expose a separate opt-in CLI/API candidate without changing current fees, orders or automatic sourcing. Record real image examples, resource/time, cache behavior and actual limitations before a dev PR.

### Verified semantic multimodal pilot

- All 301 distinct available image bodies were extracted with `gpt-6-luna`, with no model tool calls, extraction failures, new local model or supplier page access. Photos/context were hashed and cached. 1,997/2,674 fee records have complete attributes; 677 are excluded on image availability alone. Original identities are split first: train167, validation23, calibration22, test23 product groups; test is the original 38 rows. Group overlap0. Training 1,885→249, largest product1,645→12.
- Validation selects seven group-balanced neighbors and image/physical feature weight0.35. Reported quantities and HS names come from customs declarations; no unit field is populated in the source, so packaging/listing-unit semantics remain a limitation. Labels, addresses, identity and measured shipment weight were never sent to the image model.
- Fixed held-out MAE8,784.01→8,186.05 KRW; macro product MAE7,663.83→6,337.03. Normalized quantile-only intervals had inadequate held-out coverage; the final documented conservative union with independently calibrated absolute residuals prevents zero-residual quantile collapse. No point-model settings are selected from test outcomes; interval results are exploratory pilot results.
- Final80% target:32/38 rows (84.21%),20/23 groups (86.96%), median width20,600KRW. Final90% target:34/38 rows (89.47%),21/23 groups (91.30%), median width23,600KRW. Original90% median width about27,161KRW, but mean width worsens27,367→37,071KRW. Do not claim that all ranges narrowed or that shipping quotes are production-ready.
- Actual scoped-style domain HTTP with source photos and existing cache: band nesting, no external inference on cache hits, remote+5,000, unknown remote totalnull, missing image400, one-worker200/409, private path hiding and unchanged isolated orders passed. Photo examples are functional demonstrations, not extra independent test observations. Private evidence: `tmp/multimodal-shipping/{report,http-proof}.json`.
- Focused Python6 passed; Node domain392 passed/Windows-only3 skipped; host company/project integration8 passed. CLI/schema and inference boundaries were reviewed. PR/CI/merge/deployment are separate; no operating data/service or automatic sourcing changed during this experiment.

## Contract

The operator requested a local shipping-cost model using product images, names and categories, with undersampling of frequent products and an assumed KRW 5,000 remote-area surcharge. Keep it in the existing Dobi domain and company/project data directory. Do not add a resident AI server, an unrelated menu or an automatic training schedule. Expose a CLI and the existing scoped order-management API. Predictions are estimates; they must not change orders or dispatch charges.

## Evidence and labels

The current Next1688 source has 2,934 applications, 3,060 product items and 2,674 nonzero shipping-fee labels. Names are customs declarations and highly repetitive. HS codes are available as the source category; these are not Coupang or Naver category IDs. Actual shipment weight/volume, address, recipient, tracking, order identifiers and customs identifiers are not prediction inputs. Preserve the original history. Repair the HTML-XLS image extraction: the original contains 3,060 image tags, while the text-only workbook parser omitted their URLs.

The recorded `shippingFee` is treated as the base-fee label. The source does not separate remote surcharges, so this is an explicit assumption, not a claim that historical surcharges were removed. At prediction time return base estimate, remote surcharge and total separately. Apply KRW 5,000 only for an explicit remote-area flag; an unknown flag must not silently become a known non-remote destination. Do not infer mountain delivery areas from an invented address/ZIP list.

## Model and evaluation

Use a small frozen ONNX image encoder on CPU, normalized title features, hierarchical HS category features and quantity. Download only original image assets from explicitly allowed public source hosts, sequentially and with bounded bytes/time; never visit product pages or bypass login/restriction screens. Missing images remain missing and reduce confidence. Record the encoder source, license, revision and digest. No private records are sent to a model provider.

Split connected product groups before fitting or undersampling. The source commerce URL contains Taobao product IDs; hash these IDs for grouping only, never as prediction features. Link alternate images of the same source product and normalized image identities; use image-content/perceptual hashes when available. Aggregate multiple items at shipment level because the label is a shipment fee. Cap frequent groups only in the training split with a fixed seed, preserve quantity variety, and retain the original validation/test distributions. Never fit preprocessing or select settings on the test set. Compare a median baseline, title/category model and multimodal model on held-out groups, including macro-by-product MAE and uncertainty/coverage. Use an independent calibration split; category-conditional intervals require at least ten independent calibration groups, otherwise use the global conservative interval. Report absent dates, generic names, HS-only categories, failed image downloads and limited rare-product support. Do not advertise unsupported accuracy.

## Delivery checks

Focused parser, no-leakage/undersampling, explicit surcharge, missing-image, invalid-input and HTTP/scope tests. Train on a deidentified export of the real source and preserve private artifacts outside Git. Verify actual predictions, memory/time, restart persistence and unchanged source/order data. Submit a dev PR. Preserve the managed core/UI/migration journal during compatible deployment and verify the final process and API independently of a restart command's exit status.

Sources: [ONNX MobileNet model card](https://huggingface.co/onnxmodelzoo/mobilenetv2-12/blob/main/README.md), [group-aware splitting](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.GroupShuffleSplit.html).

## Verified candidate

2,674 positive-fee records were used; 260 missing-fee records were excluded. The largest original product group has 2,314 shipments. With source product IDs and shared image identity linked before splitting, training has 2,561 records and is undersampled to 252, with at most 12 per group. Validation/calibration/test use 45/30/38 untouched records across 23 groups each. All exported rows have a source product ID. 318 of 423 distinct training images were usable; record-level image coverage is about 75%. Failed assets remain missing; no product-page crawling or authentication fallback was used.

Validation selects a frozen-image/title/HS/quantity log-fee ridge model. The 38-record unseen-product test MAE is **KRW 8,784.01**, versus KRW 9,798.95 for the median baseline. Macro product MAE is KRW 7,663.83; the title/category control is KRW 7,655.37, so the image contribution is not a clear macro-level improvement. The KRW 1,000 tolerance hit rate is only 13.16%, and the conservative calibrated interval covers 86.84% of test records. Do not market this as accurate automatic pricing. It is an experimental quote aid, with broad intervals and low-confidence warnings. The earlier image-only identity split was an intermediate experiment and is not the final performance claim.

Measured candidate training peak memory is about 134 MiB. A real-image HTTP prediction completed in about 0.5 seconds; a separate local worker measurement used about 118 MiB. The worker exits afterward. A real example returned base KRW 6,200 and KRW 11,200 with the explicit remote flag. These are functional checks, not an accuracy guarantee. Isolated parser repair recovered 3,010 image URLs, preserving all IDs, original file bytes and every non-image field. Evidence is private under `tmp/shipping-cost-model/` (manifest/report, http-proof, repair-proof and resource logs); customer data, images and trained artifacts are not in Git. Operating deployment and repair need separate verification.
