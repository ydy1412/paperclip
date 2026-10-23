# Shipping-cost estimator

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
