# Local shipping-cost model

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
