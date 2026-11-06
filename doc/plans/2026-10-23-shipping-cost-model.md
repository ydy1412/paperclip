# Shipping-cost estimator

## VIP tariff-step weight classification (2026-11-06, current contract)

The user clarified that the weight model itself must use the VIP tariff's
weight steps. Do not retain the earlier 5kg classes and only convert fees.
The official VIP tables have upper-inclusive 0.5kg rows. Record the public
snapshot in next1688-vip-tariff.json. Sea routes end at449.5kg; the air table
ends at150kg. Use their common0.5kg grid and the sea table's full upper-bound
union, plus a distinct above-table class. Do not choose a user's route.

Relabel and retrain: (0,0.5], (0.5,1], (1,1.5], ... (449,449.5], >449.5kg.
For example1.2kg is the1.5kg tariff class, and exactly5kg stays in the5kg class.
The first two rows remain separate even when a route charges the same price.
Partial credit is now1/.5/.3/0 for exact/one/two/farther tariff steps (one step
is0.5kg). Do not compare these scores directly with the old5kg task.

The labels are sparse (maximum observed96kg). Preserve all valid records and
all tariff classes, including empty classes. Use a parameter-shared ordinal
location classifier with an explicit classification/expected-credit loss;
do not fit900 independent neural heads or silently drop heavy labels. Compare
bounded reward forests, photo-prior and matched hard-loss controls within
product-disjoint nested folds. Preserve the prior's uncertainty in calibration.
Report exact/adjacent accuracy, kg-distance, unseen-in-training classes,
range width in kg, coverage and actual memory. Mark extrapolation for review.

Keep coarse artifacts compatible using their own versioned band contract.
Verify half-kg boundaries, near-boundary values, both gradients, saved-model
inference on original photos, group isolation and memory. Do not change the
UI, live services or original DB. Update the existing dev PR after checks.

### VIP-step verification

- Same2,673 rows/237 groups; labels relabeled with official upper-inclusive
  steps. Independent recomputation and fit/calibration/test isolation pass.
  Existing coarse artifact point/range readback is unchanged.
- Equal-product partial credit0.38228; exact0.5kg class22.36%; within one step
  48.70%; mean rounded-class distance3.4849kg. Matched hard training0.36965,
  photo prior0.39504. Bootstrap95% credit0.33401–0.43155. The new method has
  not established a gain over photo prior. Do not reuse old coarse accuracy.
-90% target ranges cover94.37% product-weighted rows/94.09% whole products,
  but are often too wide. Upper-unbounded ranges have no finite average width.
  A13.4kg photo example predicts0.5–1kg and its0–5kg range also fails. Retain
  this error; examples are calibration-partition functionality checks only.
- The selected private candidate uses shared ordered-logistic parameters,
  expected partial credit and l2 regularization. Initial truncated-distribution
  experiment is retained separately. Source, report and fitted artifacts are in
  tmp/vip-weight/ordered/. Peak RSS394MiB/footprint621MiB, no resident AI.
- Mark the VIP experiment needs-review. No UI, API, automatic price or operating
  deployment change. Correct label granularity is implemented; reliable fine
  half-kg accuracy is not established by the present data.

## Earlier coarse ordinal experiment (2026-11-06, superseded bands)

The user replaced the exact-fee target with coarse weight classification and
removed the KRW 2,000 completion threshold from the active goal. Preserve the
older experiments below as history. Predict ordered bands: [0,5), [5,10),
[10,15), [15,20), [20,infinity) kg. These are proposed prediction display bands,
not carrier tariff thresholds or parcel-size labels. Zero/invalid/missing
weights are excluded as unlabeled, never assigned the first class.

Use the user's partial-credit rule in training, selection and evaluation:
exact=1, one band away=0.5, two bands away=0.3, farther=0. Freeze this matrix
before evaluation. Compare an ordinary classifier with reward-aware softmax
(cross-entropy plus expected partial-credit loss) and reward-vector forests.
Do not describe an evaluation-only score as a training loss.

Primary selection/evaluation gives each independent product equal total
weight. Retain group-first splitting and within-training undersampling. Use
nested grouped folds; keep a separate calibration partition in each outer
training fold. Compare class-prior, hard-label and image-prior controls.
Report exact, adjacent, partial-credit, severe underestimation, class-balanced
metrics, confusion matrix, range coverage and range width. Wide ranges must
remain visible; accepting every band is not a useful accurate model.

Reuse the complete version-1 image cache for this experiment. Do not mix it
with the interrupted, partial version-2 extraction. Use image, text, HS and
quantity; declared prices are not required for prediction. Keep actual Weight
and fee exclusively as offline targets. Weight units are a legacy kg assumption;
whether the field is actual or chargeable weight remains unverified. Expose
that limitation rather than claiming proven transfer to another forwarder.

Provide a private trained artifact and a bounded CLI prediction path. Keep
Next1688 historical fee references separate from common weight classification,
and never present them as another provider's tariff. Preserve existing APIs
and production data. Verify training-loss gradients, boundaries, missing labels,
product isolation, fitted-artifact readback, original-photo inference and memory.

### Verified ordinal pilot

- Eligible: 2,673 positive-weight records, 237 product groups; one missing-weight
  product excluded from the 2,674 fee records. Five outer group folds, two
  inner selection folds, separate 20% calibration groups. Training caps groups
  at 12 and gives each group equal total weight. Evaluation is not sampled.
- Reward-aware classifier with a photo-prior offset: equal-product partial
  credit 0.83797, exact band 72.28%, within one band 92.41%, underestimation by
  at least two bands 4.85%. Hard-label softmax: 0.78158 / 67.93% / 83.97% / 14.98%.
  The stronger photo-prior-only baseline is 0.84177 and the matched hard-training
  control 0.83840. The new loss does not establish a performance advantage.
- Nominal90 range coverage: equal-product rows91.35%, whole products89.87%.
  Mean2.19 bands, one/two bands73.87%, all five5.53%. Rare15–20kg recall10%
  (9 rows8 groups) remains weak. Product bootstrap credit95%:0.80246–0.87097.
  These are reused historical comparisons, not future/other-forwarder validation.
- Actual saved-artifact readback uses cached original photos in five calibration
  examples: recorded0.6→<5kg,9.7→5–10kg,13.4→<5kg (range<15kg),18.4→15–20kg,
  33.3→20+kg. Retain the error. These examples test functionality, not fresh
  accuracy. Original photo inference uses the existing pinned ONNX encoder and
  complete v1 attributes. The interrupted216-entry v2 cache is unchanged.
- Private evidence: tmp/ordinal-shipping/prior-correction/{plan,report,
  independent-validation,examples,cli-result}.json, predictions.npz,
  validation.png, source/, candidate/{manifest.json,classifier.joblib,encoder.onnx}.
  New CLI inference runs without a persistent service or remote model request.
  Peak image-inference footprint about276MiB; first full photo pass about2.8s,
  following in-process examples about0.04–0.05s. Full CLI cold start measured
  separately. The existing scoped fee APIs and UI are unchanged.
- Focused Python36 and Node4 tests pass. Python includes analytical-gradient,
  partial-credit loss, boundaries, missing labels, product-balanced metrics,
  disjoint fit/calibration/test, artifact integrity and fallback checks. Separate
  CI job installs optional dependencies so these tests are not silently skipped.

## Earlier MAE below KRW 2,000 research (superseded objective)

The user requested a data-science effort to reach mean absolute forwarding-fee
error below KRW2,000 using the existing data. Keep this objective active until
it is achieved and verified; do not call a narrower successful segment complete.
Start by auditing labels, repeat-product concentration, feature equivalence,
missing images and the largest errors. Preserve all valid nonzero fee records
in the full benchmark; report image-complete and full-source coverage separately.

Primary accuracy is row MAE on product-disjoint data; also report macro-product
MAE, median/90th errors, underestimation cost, coverage, and memory/time. Existing
38-row results are a repeatedly inspected research benchmark. Do not tune on
it or call it new future validation. Establish deterministic grouped outer
evaluation and within-training selection before comparing candidate methods.
All preprocessing, sampling and parameter fitting must remain inside each
training partition. Record exact population, split and candidate definitions.
No outcome weight, IDs, freight after shipment, customer or routing results may
enter an image prompt or deployable query features. Oracle measured-weight
comparisons are allowed only as explicitly separate data-quality diagnostics.

Compare robust tabular, semantic text/image, quantity-aware neighbor, and
physical/tariff-guided models within a bounded predeclared search. Keep frequent
products undersampled and product-balanced metrics visible. Audit surprisingly
good results for leakage and dependence. Do not drop expensive goods, renormalize
the target, or only score familiar products to satisfy the threshold. Retain
scripts, per-row out-of-fold predictions, fitted artifacts, and validation
results; update the existing dev PR when a defensible improvement is ready.
Production data, deployment and resident model services remain unchanged.

### Data audit and first nested benchmark

- Original source XLS and DB match on all2,674 positive fees and weights.
  There are238 independent groups, with2,314 rows (86.5%) in one product group.
  Complete old image attributes cover1,997 rows235 groups; no rows are removed
  from the new full-source evaluation. A constant6,500 baseline has in-sample
  row MAE1,600 but macro-product MAE9,808. This is not a new-product solution.
- The first private18-candidate nested5x2 grouped experiment gives row OOF
  MAE1,795.17 and macro-product MAE5,985.77. All2,674 rows are scored once with
  independent preprocessing and selection. An independent recomputation agrees.
  Product bootstrap95% row-MAE range1,283–8,138 is wide; no prospective accuracy
  claim. Only130/238 groups have MAE below2,000. Do not declare the goal done
  from the frequency-weighted number or substitute this for a shipped model.
- Large legacy errors include a machine whose working capacity was misread as
  product size, and multi-unit bulky goods. Compare per-unit weight/fee models,
  supervised mass-to-cost models, and label-free higher-quality image attributes.
  The revised extractor is tool-free, keeps compatibility dimensions separate,
  and processes original photos serially with cached, versioned results.
- The operator confirmed Value/가격 currency is CNY on2026-11-06. Value agrees
  with sum(item price x quantity) within rounding (ratio0.9962–1.0058), so use
  declared total and per-unit CNY features without multiplying quantity twice.
  This is reported product value, not a shipment outcome or guaranteed purchase
  cost. No price, target fee, outcome weight or customer data enters vision.
  Add explicit regression export; preserve default fee-export behavior.

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
