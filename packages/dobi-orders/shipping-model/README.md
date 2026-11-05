# Local shipping-cost model

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
